import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../config/prisma.service';
import { FORUM_SLUG, ForumService } from '../forum.service';

/**
 * MaybeOS's own forum (FRM-01).
 *
 * Most of what matters is about *not* doing things: not billing it, not
 * counting it as a customer, not enrolling somebody in a public roster they
 * never asked to be on, and above all not letting any of it break founding a
 * co-op.
 */
describe('ForumService', () => {
  let prisma: any;
  let service: ForumService;

  const forum = { id: 'forum1', name: 'The MaybeOS Community', slug: FORUM_SLUG };

  beforeEach(async () => {
    prisma = {
      organization: { findFirst: jest.fn().mockResolvedValue(forum), create: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({ forumOptOutAt: null }),
        update: jest.fn(),
      },
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [ForumService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ForumService);
  });

  describe('auto-join must never break founding a co-op', () => {
    it('adds the founder', async () => {
      await expect(service.autoJoin('u1', 'neworg')).resolves.toBe('joined');
      expect(prisma.userOrg.create).toHaveBeenCalled();
    });

    it('says nothing when no forum exists on this deployment', async () => {
      // Not an error a new customer should ever see.
      prisma.organization.findFirst.mockResolvedValue(null);
      await expect(service.autoJoin('u1', 'neworg')).resolves.toBe('skipped');
    });

    it('swallows a database failure rather than failing the org', async () => {
      prisma.userOrg.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.autoJoin('u1', 'neworg')).resolves.toBe('skipped');
    });

    it('does not try to enrol the forum’s own creator in the forum', async () => {
      await expect(service.autoJoin('u1', 'forum1')).resolves.toBe('skipped');
      expect(prisma.userOrg.create).not.toHaveBeenCalled();
    });
  });

  describe('leaving means left', () => {
    it('does not drag back somebody who opted out', async () => {
      // Founding a second co-op is not a change of mind.
      prisma.user.findUnique.mockResolvedValue({ forumOptOutAt: new Date() });
      await expect(service.autoJoin('u1', 'neworg')).resolves.toBe('skipped');
      expect(prisma.userOrg.create).not.toHaveBeenCalled();
    });

    it('records the opt-out on the user, not on the missing row', async () => {
      // A missing membership is indistinguishable from never having joined,
      // and the difference decides what happens next time they found a co-op.
      await service.leave('u1');
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toHaveLength(2);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { forumOptOutAt: expect.any(Date) } }),
      );
    });

    it('clears the opt-out when somebody comes back', async () => {
      await service.rejoin('u1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { forumOptOutAt: null } }),
      );
    });

    it('does not add somebody twice', async () => {
      prisma.userOrg.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.autoJoin('u1', 'neworg')).resolves.toBe('skipped');
      expect(prisma.userOrg.create).not.toHaveBeenCalled();
    });
  });

  describe('nobody is listed without asking', () => {
    it('joins members hidden from the directory', async () => {
      // They did not ask to join this. Being enrolled in a roster of every
      // MaybeOS customer without being asked is fine until the day it is not.
      await service.autoJoin('u1', 'neworg');
      expect(prisma.userOrg.create.mock.calls[0][0].data.isPublic).toBe(false);
    });

    it('reports whether they are listed, so the UI can offer it', async () => {
      prisma.userOrg.findUnique.mockResolvedValue({ id: 'm1', isPublic: false });
      await expect(service.statusFor('u1')).resolves.toMatchObject({
        member: true,
        listedInDirectory: false,
      });
    });
  });

  describe('creating it', () => {
    beforeEach(() => {
      prisma.organization.findFirst.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue(forum);
    });

    it('is never billed', async () => {
      // A per-member plan across every organiser on the platform would
      // invoice MaybeOS to MaybeOS, monthly, at scale.
      await service.ensure('admin1');
      expect(prisma.organization.create.mock.calls[0][0].data).toMatchObject({
        isPlatformForum: true,
        billingWaived: true,
      });
    });

    it('is not joinable by anyone with a card', async () => {
      await service.ensure('admin1');
      expect(prisma.organization.create.mock.calls[0][0].data.allowPublicJoin).toBe(false);
    });

    it('fills itself with the organisers who already exist', async () => {
      // A forum containing only co-ops founded after today is a forum with
      // nobody in it on the day it opens.
      prisma.userOrg.findMany.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);
      const result = await service.ensure('admin1');
      expect(result.backfilled).toBe(2);
      expect(prisma.userOrg.createMany.mock.calls[0][0].data).toHaveLength(2);
    });

    it('skips organisers who already said no', async () => {
      await service.ensure('admin1');
      expect(prisma.userOrg.findMany.mock.calls[0][0].where.user).toEqual({ forumOptOutAt: null });
    });

    it('does not count the forum’s own organisers as co-op organisers', async () => {
      await service.ensure('admin1');
      expect(prisma.userOrg.findMany.mock.calls[0][0].where.org).toEqual({
        isPlatformForum: false,
      });
    });

    it('is idempotent — a second call returns the first forum', async () => {
      prisma.organization.findFirst.mockResolvedValue(forum);
      const result = await service.ensure('admin1');
      expect(result.created).toBe(false);
      expect(prisma.organization.create).not.toHaveBeenCalled();
    });
  });
});
