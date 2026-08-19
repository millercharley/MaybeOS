import { AttachmentsService } from '../attachments.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Files members attach, and the three ways that could go wrong.
 *
 * The bytes never pass through the API — a Netlify Function caps a request at
 * about 6 MB and base64 inflates a file by a third, so the browser uploads
 * straight to Supabase and only metadata comes back. That moves the trust
 * boundary, and these pin where it now sits:
 *
 *   1. the caller never chooses the path, so it cannot write into another
 *      co-op's folder
 *   2. the owner is resolved through its org, so an attachment cannot be hung
 *      off another co-op's post (SEC-04)
 *   3. "uploaded" is a claim from a browser until the object is confirmed, or
 *      an abandoned upload leaves a row rendering as a broken file forever
 */
describe('AttachmentsService', () => {
  const build = (over: Record<string, unknown> = {}) => {
    const prisma = {
      post: { findFirst: jest.fn().mockResolvedValue({ id: 'post-1' }) },
      comment: { findFirst: jest.fn().mockResolvedValue({ id: 'comment-1' }) },
      event: { findFirst: jest.fn().mockResolvedValue({ id: 'event-1' }) },
      attachment: {
        create: jest.fn((args: { data: unknown }) => ({ id: 'a1', ...(args.data as object) })),
        findFirst: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...over,
    };
    const storage = {
      createAttachmentUploadUrl: jest.fn().mockResolvedValue({ uploadUrl: 'https://x', path: 'org-1/f.png' }),
      attachmentExists: jest.fn().mockResolvedValue({ sizeBytes: 1234 }),
      signedAttachmentUrl: jest.fn().mockResolvedValue('https://signed'),
      deleteAttachment: jest.fn(),
    };
    return { service: new AttachmentsService(prisma as never, storage as never), prisma, storage };
  };

  const dto = (over: Record<string, unknown> = {}) =>
    ({ path: 'org-1/abc.png', fileName: 'kiln.png', mimeType: 'image/png', postId: 'post-1', ...over }) as never;

  describe('recording an upload', () => {
    it('stores the size storage reports, not one the client claimed', async () => {
      const { service, prisma } = build();
      await service.record('org-1', 'user-1', dto());

      expect(prisma.attachment.create.mock.calls[0][0].data.sizeBytes).toBe(1234);
    });

    it('refuses a path outside the co-op’s own folder', async () => {
      const { service } = build();
      await expect(
        service.record('org-1', 'user-1', dto({ path: 'someone-else/abc.png' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when the object was never uploaded', async () => {
      const { service, storage } = build();
      storage.attachmentExists.mockResolvedValue(null);

      await expect(service.record('org-1', 'user-1', dto())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a post belonging to another co-op', async () => {
      const { service, prisma } = build();
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(service.record('org-1', 'user-1', dto())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves the post through its org rather than by id alone', async () => {
      const { service, prisma } = build();
      await service.record('org-1', 'user-1', dto());

      expect(prisma.post.findFirst.mock.calls[0][0].where).toEqual({
        id: 'post-1',
        channel: { orgId: 'org-1' },
      });
    });

    it('insists on exactly one owner', async () => {
      const { service } = build();

      await expect(
        service.record('org-1', 'user-1', dto({ commentId: 'comment-1' })),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.record('org-1', 'user-1', dto({ postId: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('removing one', () => {
    const owned = { id: 'a1', uploaderId: 'user-1', path: 'org-1/abc.png' };

    it('lets the person who attached it remove it', async () => {
      const { service, prisma, storage } = build();
      prisma.attachment.findFirst.mockResolvedValue(owned);

      await service.remove('org-1', 'a1', { userId: 'user-1', isStaff: false });

      expect(prisma.attachment.delete).toHaveBeenCalled();
      expect(storage.deleteAttachment).toHaveBeenCalledWith('org-1', 'org-1/abc.png');
    });

    it('lets an organiser moderate somebody else’s', async () => {
      const { service, prisma } = build();
      prisma.attachment.findFirst.mockResolvedValue({ ...owned, uploaderId: 'someone-else' });

      await expect(
        service.remove('org-1', 'a1', { userId: 'organiser', isStaff: true }),
      ).resolves.toEqual({ removed: true });
    });

    it('refuses another member removing it', async () => {
      const { service, prisma } = build();
      prisma.attachment.findFirst.mockResolvedValue({ ...owned, uploaderId: 'someone-else' });

      await expect(
        service.remove('org-1', 'a1', { userId: 'nosy', isStaff: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('deletes the row before the object', async () => {
      // A failed object delete orphans a file, which is recoverable. The
      // reverse leaves a row rendering as a broken file, which is not.
      const order: string[] = [];
      const { service, prisma, storage } = build();
      prisma.attachment.findFirst.mockResolvedValue(owned);
      prisma.attachment.delete.mockImplementation(() => { order.push('row'); return {}; });
      storage.deleteAttachment.mockImplementation(() => { order.push('object'); });

      await service.remove('org-1', 'a1', { userId: 'user-1', isStaff: false });

      expect(order).toEqual(['row', 'object']);
    });
  });
});
