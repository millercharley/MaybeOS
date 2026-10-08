import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';
import { AuditService } from '../../platform/audit.service';

/**
 * Taking the address back, against the database (MEM-28).
 *
 * The rules are covered in `member-takeover.spec.ts`; this covers the writes,
 * where the mistakes are of a different kind — an ownership stake moved to the
 * wrong account, or a husk deleted before the things it held were carried off
 * it.
 */
describe('MemberService — taking an address back', () => {
  let service: MemberService;
  let prisma: any;
  let audit: any;
  let tx: any;

  const KEEP = 'u-keep';
  const HUSK = { id: 'u-husk', name: 'Evan Mascagni', passwordHash: null, lastLoginAt: null };

  beforeEach(async () => {
    tx = {
      booking: { updateMany: jest.fn() },
      shareGrant: { updateMany: jest.fn() },
      user: { delete: jest.fn(), update: jest.fn() },
      userOrg: { updateMany: jest.fn() },
    };

    prisma = {
      userOrg: { findFirst: jest.fn().mockResolvedValue({ userId: KEEP }) },
      user: { findFirst: jest.fn().mockResolvedValue({ ...HUSK, _count: { orgs: 0 } }) },
      booking: { count: jest.fn().mockResolvedValue(3) },
      shareGrant: {
        findMany: jest.fn().mockResolvedValue([{ shares: 200 }, { shares: 100 }]),
      },
      threadMessage: { count: jest.fn().mockResolvedValue(0) },
      threadParticipant: { count: jest.fn().mockResolvedValue(0) },
      threadMessageReaction: { count: jest.fn().mockResolvedValue(0) },
      commentReaction: { count: jest.fn().mockResolvedValue(0) },
      attachment: { count: jest.fn().mockResolvedValue(0) },
      eventCoHost: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    audit = { record: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: BuddyService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  describe('looking first', () => {
    it('reports what it would move, without writing anything', async () => {
      const preview = await service.previewTakeover('org-1', KEEP, 'evan.mascagni@gmail.com');

      expect(preview).toMatchObject({
        can: true,
        contents: { bookings: 3, shareGrants: 2, shares: 300 },
      });
      expect(preview.message).toContain('300 shares');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an account that is still a member somewhere', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...HUSK, _count: { orgs: 1 } });

      const preview = await service.previewTakeover('org-1', KEEP, 'someone@example.com');
      expect(preview).toMatchObject({ can: false, reason: 'still-a-member' });
    });

    it('scopes the surviving member to this co-op', async () => {
      // SEC-04: a membership is tenant-owned, and the caller writes the URL.
      await service.previewTakeover('org-1', KEEP, 'evan.mascagni@gmail.com');

      expect(prisma.userOrg.findFirst).toHaveBeenCalledWith({
        where: { orgId: 'org-1', userId: KEEP },
        select: { userId: true },
      });
    });
  });

  describe('taking it', () => {
    it('carries the bookings and the shares before deleting anything', async () => {
      const order: string[] = [];
      tx.booking.updateMany.mockImplementation(async () => void order.push('bookings'));
      tx.shareGrant.updateMany.mockImplementation(async () => void order.push('grants'));
      tx.user.delete.mockImplementation(async () => void order.push('delete'));

      await service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1');

      // Deleting first would take the husk's ownership stake with it.
      expect(order).toEqual(['bookings', 'grants', 'delete']);
    });

    it('re-addresses the grants as it moves them', async () => {
      /*
        `holderEmail` is how an unclaimed grant finds its owner again. Leaving
        the old address on a grant that now belongs to somebody else would be a
        second way to read it, disagreeing with the first.
      */
      await service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1');

      expect(tx.shareGrant.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-husk' },
        data: { userId: KEEP, holderEmail: 'evan.mascagni@gmail.com' },
      });
    });

    it('does it all in one transaction', async () => {
      // A half-done takeover is two accounts each holding part of somebody,
      // which is worse than the duplicate it was meant to fix.
      await service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('gives the member the address', async () => {
      await service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: KEEP },
          data: expect.objectContaining({
            email: 'evan.mascagni@gmail.com',
            emailVerified: false,
          }),
        }),
      );
    });

    it('refuses rather than writing when the husk carries something it cannot move', async () => {
      prisma.threadMessage.count.mockResolvedValue(2);

      await expect(
        service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1'),
      ).rejects.toThrow(/2 messages/);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records the numbers, so the log answers where the shares came from', async () => {
      await service.takeOverAddress('org-1', KEEP, 'evan.mascagni@gmail.com', 'admin-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          actorId: 'admin-1',
          action: 'member.address_taken_over',
          metadata: expect.objectContaining({
            removedAccountId: 'u-husk',
            bookingsMoved: 3,
            shareGrantsMoved: 2,
            sharesMoved: 300,
          }),
        }),
      );
    });
  });
});
