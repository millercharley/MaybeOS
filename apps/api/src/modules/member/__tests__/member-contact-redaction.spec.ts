import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';

/**
 * The member directory redacts contact and billing details.
 *
 * `GET /orgs/:orgId/members` is open to any member of the org and returned
 * whole rows: every other member's email address, Stripe customer and
 * subscription ids, and subscription status. Joining a co-op should not hand
 * you its mailing list.
 */
describe('MemberService — contact redaction', () => {
  let service: MemberService;
  let prisma: {
    userOrg: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const row = (userId: string, email: string) => ({
    id: `membership-${userId}`,
    userId,
    orgId: 'org-1',
    role: 'MEMBER',
    memberSince: new Date('2026-01-01'),
    bio: 'Potter, bread enthusiast',
    tags: ['pottery'],
    isPublic: true,
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'ACTIVE',
    emailOptIn: true,
    headline: 'Ask me about sourdough',
    location: 'Butchertown, KY',
    user: { id: userId, email, name: 'Alex', avatarUrl: null },
    tier: { id: 'tier-1', name: 'Sustainer' },
  });

  beforeEach(async () => {
    prisma = {
      userOrg: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        // Never reached here: the buddy search is fire-and-forget and off by default.
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  const listAs = async (viewer: { userId: string; privileged: boolean }) => {
    prisma.userOrg.findMany.mockResolvedValue([
      row('user-2', 'other@example.com'),
      row('user-1', 'me@example.com'),
    ]);
    prisma.userOrg.count.mockResolvedValue(2);
    return (await service.listMembers('org-1', viewer)).data;
  };

  it('withholds another member\'s email from an ordinary member', async () => {
    const [other] = await listAs({ userId: 'user-1', privileged: false });

    expect(other.user).not.toHaveProperty('email');
    // The directory still works: name, face and role all survive.
    expect(other.user.name).toBe('Alex');
    expect(other.role).toBe('MEMBER');
  });

  it('withholds their billing details too', async () => {
    const [other] = await listAs({ userId: 'user-1', privileged: false });

    expect(other).not.toHaveProperty('stripeCustomerId');
    expect(other).not.toHaveProperty('stripeSubscriptionId');
    expect(other).not.toHaveProperty('subscriptionStatus');
  });

  it('withholds whether another member agreed to be emailed', async () => {
    const [other] = await listAs({ userId: 'user-1', privileged: false });

    // Marketing consent belongs beside the email address it governs (MEM-06).
    // A member who can't see the address has no business knowing whether it
    // may be written to.
    expect(other).not.toHaveProperty('emailOptIn');
    // The profile a member wrote for this co-op still shows, though.
    expect(other.headline).toBe('Ask me about sourdough');
    expect(other.location).toBe('Butchertown, KY');
  });

  it('leaves the caller\'s own record whole', async () => {
    const rows = await listAs({ userId: 'user-1', privileged: false });
    const self = rows.find((r) => r.userId === 'user-1');

    expect(self?.user.email).toBe('me@example.com');
    expect(self?.subscriptionStatus).toBe('ACTIVE');
  });

  it('gives organisers everything, since contacting members is their job', async () => {
    const [other] = await listAs({ userId: 'user-1', privileged: true });

    expect(other.user.email).toBe('other@example.com');
    expect(other.stripeCustomerId).toBe('cus_123');
  });

  it('will not let an ordinary member search by email', async () => {
    prisma.userOrg.findMany.mockResolvedValue([]);
    prisma.userOrg.count.mockResolvedValue(0);

    await service.listMembers('org-1', { userId: 'user-1', privileged: false }, 1, 20, 'alex@');

    // Matching on email would answer "does this address belong to a member
    // here?" even with the address redacted from the response.
    const where = prisma.userOrg.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('email');
    expect(where.user.name).toEqual({ contains: 'alex@', mode: 'insensitive' });
  });

  it('still lets organisers search by email', async () => {
    prisma.userOrg.findMany.mockResolvedValue([]);
    prisma.userOrg.count.mockResolvedValue(0);

    await service.listMembers('org-1', { userId: 'user-1', privileged: true }, 1, 20, 'alex@');

    const where = prisma.userOrg.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('email');
  });

  it('redacts the single-member detail route as well', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(row('user-2', 'other@example.com'));

    const member = await service.getMember('org-1', 'user-2', {
      userId: 'user-1',
      privileged: false,
    });

    expect(member.user).not.toHaveProperty('email');
  });
});
