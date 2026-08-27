import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AttachmentsService } from '../attachments.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';

/**
 * The files on a public event (EVT-14).
 *
 * Every other attachment route is membership-guarded and should be. This one
 * is the exception, so the tests are about how narrow the exception is: what
 * it will not return, and what it will not confirm exists.
 */
describe('AttachmentsService — a public event’s files', () => {
  let service: AttachmentsService;
  let prisma: any;

  const attachment = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    fileName: 'poster.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    path: 'org-1/poster.png',
    createdAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      event: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
      attachment: { findMany: jest.fn().mockResolvedValue([attachment()]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { signedAttachmentUrl: jest.fn().mockResolvedValue('https://signed/poster.png') },
        },
      ],
    }).compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  it('returns the poster on a published public event', async () => {
    const [file] = await service.listForPublicEvent('sunrise', 'repair-cafe');

    expect(file).toMatchObject({ fileName: 'poster.png', url: 'https://signed/poster.png' });
  });

  describe('how narrow the exception is', () => {
    it('asks for PUBLIC, published and not cancelled — in the query, not after', async () => {
      await service.listForPublicEvent('sunrise', 'repair-cafe');

      // A filter applied after the fetch is a filter somebody edits out later.
      expect(prisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            visibility: 'PUBLIC',
            isPublished: true,
            canceledAt: null,
          }),
        }),
      );
    });

    it('returns only files hung on the event itself', async () => {
      await service.listForPublicEvent('sunrise', 'repair-cafe');

      // A comment underneath a public event is still members-only: the event
      // is public, the co-op's conversation about it is not (EVT-11). So
      // comment and post files are unreachable by construction rather than by
      // being filtered out.
      const { where } = prisma.attachment.findMany.mock.calls[0][0];
      expect(where).toEqual({ orgId: 'org-1', eventId: 'e1' });
      expect(where).not.toHaveProperty('commentId');
      expect(where).not.toHaveProperty('postId');
    });

    it('does not confirm that a members-only or unpublished event exists', async () => {
      // Not found rather than forbidden — the same rule the public event
      // endpoint follows. "Forbidden" tells a stranger the event is real.
      prisma.event.findFirst.mockResolvedValue(null);

      await expect(service.listForPublicEvent('sunrise', 'private-thing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not confirm that a co-op exists', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.listForPublicEvent('nope', 'x')).rejects.toThrow(NotFoundException);
    });

    it('signs briefly even though the file is public', async () => {
      const storage = (service as unknown as { storage: { signedAttachmentUrl: jest.Mock } }).storage;
      await service.listForPublicEvent('sunrise', 'repair-cafe');

      // The URL's secrecy was never the protection here — but visibility can
      // change, and a short life means un-publishing takes effect in minutes
      // rather than an hour.
      expect(storage.signedAttachmentUrl).toHaveBeenCalledWith('org-1/poster.png', 300);
    });
  });
});
