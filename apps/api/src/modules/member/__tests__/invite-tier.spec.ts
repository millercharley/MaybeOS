import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';

/**
 * An invitation carries the tier it is inviting somebody onto (MEM-04).
 *
 * Accepting used to create a membership with `role` and nothing else, so an
 * invited member joined with no tier and no dues while somebody arriving
 * through the public join page paid — one co-op, two prices, decided by which
 * door you came through. Nobody would notice until the accounts did not match
 * the membership list.
 */
describe('MemberService — invitations with a tier', () => {
  let service: MemberService;
  let prisma: any;

  const invitation = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    orgId: 'org-1',
    email: 'invitee@example.com',
    role: 'MEMBER',
    tierId: 'tier-1',
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      invitation: {
        findUnique: jest.fn().mockResolvedValue(invitation()),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ token: 'tok', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      membershipTier: { findFirst: jest.fn().mockResolvedValue({ id: 'tier-1' }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1', name: 'Sunrise' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Maya' }) },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendInvite: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        // Never reached here: the buddy search is fire-and-forget and off by default.
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  describe('accepting', () => {
    const membershipCreated = () =>
      prisma.userOrg.create.mock.calls[0][0].data;

    it('puts the invited member on the tier they were invited to', async () => {
      await service.acceptInvite('tok', 'user-1');

      expect(membershipCreated().tierId).toBe('tier-1');
    });

    it('returns the tier so the caller can hand off to payment', async () => {
      // A caller that never learns the tier cannot send anyone to checkout,
      // which is exactly how the invitation path stopped short of dues.
      const result = await service.acceptInvite('tok', 'user-1');

      expect(result.tierId).toBe('tier-1');
    });

    it('joins with no dues when the invitation names no tier', async () => {
      // Right for staff, and for co-ops that do not charge at all.
      prisma.invitation.findUnique.mockResolvedValue(invitation({ tierId: null }));

      const result = await service.acceptInvite('tok', 'user-1');

      expect(membershipCreated().tierId).toBeNull();
      expect(result.tierId).toBeNull();
    });

    it('still refuses an invitation that was already accepted', async () => {
      prisma.invitation.findUnique.mockResolvedValue(invitation({ acceptedAt: new Date() }));

      await expect(service.acceptInvite('tok', 'user-1')).rejects.toThrow();
    });

    it('still refuses an expired one', async () => {
      prisma.invitation.findUnique.mockResolvedValue(
        invitation({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.acceptInvite('tok', 'user-1')).rejects.toThrow();
    });
  });

  describe('joining after an invitation', () => {
    it('lets an existing member reach checkout in an invitation-only co-op', async () => {
      // Found by walking the flow: accepting an invitation hands the member to
      // /join to set up dues, and the public-join gate refused them with "ask
      // an organiser for an invite" — which is exactly what they had just
      // used. Someone already a member is not joining, so that gate has
      // nothing left to guard.
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Sunrise',
        allowPublicJoin: false,
      });
      prisma.userOrg.findUnique.mockResolvedValue({ id: 'membership-1', tierId: 'tier-1' });

      const result = await service.joinOrg('org-1', 'user-1', 'tier-1');

      expect(result.alreadyMember).toBe(true);
    });

    it('still refuses a stranger joining an invitation-only co-op', async () => {
      // The gate has to keep doing its job for everybody who is not already in.
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Sunrise',
        allowPublicJoin: false,
      });
      prisma.userOrg.findUnique.mockResolvedValue(null);

      await expect(service.joinOrg('org-1', 'stranger', 'tier-1')).rejects.toThrow(
        /invitation only/i,
      );
      expect(prisma.userOrg.create).not.toHaveBeenCalled();
    });
  });

  describe('sending', () => {
    it('checks the tier belongs to this co-op before storing it', async () => {
      // An invitation pointing at another co-op's tier would fail at checkout,
      // long after the admin who sent it has stopped watching.
      await service.inviteMember('org-1', 'A@Example.com ', 'MEMBER', 'admin-1', 'tier-1');

      expect(prisma.membershipTier.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tier-1', orgId: 'org-1', isActive: true },
        }),
      );
      expect(prisma.invitation.create.mock.calls[0][0].data.tierId).toBe('tier-1');
    });

    it('stores no tier when the named one is not this co-op’s', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(null);

      await service.inviteMember('org-1', 'a@example.com', 'MEMBER', 'admin-1', 'someone-elses');

      // Undefined rather than the id: better to invite with no dues than to
      // send somebody at a checkout that cannot work.
      expect(prisma.invitation.create.mock.calls[0][0].data.tierId).toBeUndefined();
    });

    it('stores no tier when none was asked for', async () => {
      await service.inviteMember('org-1', 'a@example.com', 'STAFF', 'admin-1');

      expect(prisma.invitation.create.mock.calls[0][0].data.tierId).toBeNull();
      expect(prisma.membershipTier.findFirst).not.toHaveBeenCalled();
    });
  });
});
