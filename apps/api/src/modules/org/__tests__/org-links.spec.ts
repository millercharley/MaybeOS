import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgService } from '../org.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ForumService } from '../forum.service';

/**
 * Links to things a co-op keeps outside MaybeOS (NAV-02).
 *
 * These are written by one person and clicked by everybody else in the co-op,
 * which is what makes the URL check load-bearing rather than tidy: a scheme
 * that executes is script execution in another member's session. The rest of
 * this file is the ordinary care every list in the product now gets — org
 * scoping, appended rather than prepended, one transaction for the order.
 */
describe('OrgService — links off MaybeOS', () => {
  let service: OrgService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgService,
        {
          provide: PrismaService,
          useValue: {
            orgLink: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              updateMany: jest.fn(),
              delete: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: StorageService, useValue: {} },
        { provide: ForumService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrgService>(OrgService);
    prisma = module.get(PrismaService);
  });

  describe('what may be stored as a link', () => {
    it('keeps an ordinary https address', async () => {
      const link = await service.createLink(ORG, { label: 'Store', url: 'https://shop.example.com/x' });
      expect(link.url).toBe('https://shop.example.com/x');
    });

    it('assumes https for an address typed without one', async () => {
      // Somebody putting a link in a sidebar is not thinking about schemes,
      // and refusing them over a missing prefix is a worse product.
      const link = await service.createLink(ORG, { label: 'Instagram', url: 'instagram.com/maybeitsfate' });
      expect(link.url).toBe('https://instagram.com/maybeitsfate');
    });

    it('refuses javascript:', async () => {
      // The whole reason this check exists: one member writes it, every other
      // member clicks it.
      await expect(
        service.createLink(ORG, { label: 'Free money', url: 'javascript:alert(document.cookie)' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.orgLink.create).not.toHaveBeenCalled();
    });

    it('refuses data: and file:', async () => {
      await expect(
        service.createLink(ORG, { label: 'x', url: 'data:text/html,<script>1</script>' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createLink(ORG, { label: 'x', url: 'file:///etc/passwd' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a link with no name', async () => {
      await expect(
        service.createLink(ORG, { label: '   ', url: 'https://example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks the address again when a link is edited', async () => {
      // A link can be made safe on the way in and hostile on the way past.
      prisma.orgLink.findFirst.mockResolvedValue({ id: 'l1', orgId: ORG } as never);

      await expect(
        service.updateLink(ORG, 'l1', { url: 'javascript:alert(1)' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.orgLink.update).not.toHaveBeenCalled();
    });
  });

  describe('the ordinary care', () => {
    it('appends rather than jumping to the top', async () => {
      prisma.orgLink.findFirst.mockResolvedValue({ position: 3 } as never);

      const link = await service.createLink(ORG, { label: 'New', url: 'https://example.com' });

      expect(link.position).toBe(4);
    });

    it('refuses to edit or delete a link from another co-op', async () => {
      prisma.orgLink.findFirst.mockResolvedValue(null);

      await expect(service.updateLink(ORG, 'elsewhere', { label: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.deleteLink(ORG, 'elsewhere')).rejects.toThrow(NotFoundException);
      expect(prisma.orgLink.delete).not.toHaveBeenCalled();
    });

    it('scopes every reorder write to this co-op', async () => {
      await service.reorderLinks(ORG, ['a', 'b']);

      expect(prisma.orgLink.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', orgId: ORG },
        data: { position: 0 },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
