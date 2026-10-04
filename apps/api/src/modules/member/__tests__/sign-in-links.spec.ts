import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Telling a roster how to get in (MEM-18).
 *
 * This exists because the invitation path cannot do it: `inviteMember`
 * refuses anybody who already has a membership — "This person is already a
 * member of this organization" — and after a CSV import all 364 of them do.
 * Found on 2026-10-02 when Charley imported one test member and no email
 * arrived, which was correct and also the end of the plan as written.
 *
 * The failures worth pinning are the ones that would be discovered at 364
 * people: a roster emailed twice, a member with a password being told how to
 * get one, and a link that has expired by the time somebody reads it.
 */
describe('sending a roster its way in', () => {
  let service: MemberService;
  let prisma: any;
  let email: any;

  const ORG = { id: 'org-1', name: 'MaybeItsFate', inviteExpiryDays: 30 };

  const waiting = [
    // The second carries a forum address as well as a billed one (MEM-19).
    { id: 'm1', userId: 'u1', altEmail: null, user: { email: 'ada@example.com', name: 'Ada' } },
    { id: 'm2', userId: 'u2', altEmail: 'bo-forum@example.com', user: { email: 'bo@example.com', name: null } },
  ];

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue(ORG) },
      userOrg: {
        findMany: jest.fn().mockResolvedValue(waiting),
        count: jest.fn().mockResolvedValue(2),
        update: jest.fn(),
      },
      user: { update: jest.fn() },
      belongingEmailTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    email = { sendRaw: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn() } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('writes to members who have no way in, and only those', async () => {
    await service.sendSignInLinks('org-1');

    const where = prisma.userOrg.findMany.mock.calls[0][0].where;

    // Never set a password: somebody who has signed in does not need telling
    // how, and being emailed instructions for an account you already use
    // reads as a product that does not know you.
    expect(where.user).toEqual({ passwordHash: null });
    expect(where.signInSentAt).toBeNull();
    expect(where.role).toEqual({ in: ['ADMIN', 'STAFF', 'MEMBER'] });
  });

  it('sends in the co-op’s name, with a link that signs them straight in', async () => {
    await service.sendSignInLinks('org-1');

    const [to, subject, html] = email.sendRaw.mock.calls[0];

    expect(to).toEqual({ primary: 'ada@example.com', also: null });
    expect(subject).toBe('Your MaybeItsFate account is ready');
    expect(html).toContain('https://maybeos.org/magic-link?token=');
    // The sentence the whole email exists for.
    expect(html).toMatch(/nothing has changed about your dues/i);
  });

  it('gives the link the co-op’s own expiry, not fifteen minutes', async () => {
    await service.sendSignInLinks('org-1');

    const expiry = prisma.user.update.mock.calls[0][0].data.magicLinkExpiry as Date;
    const days = Math.round((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

    // A self-service magic link lives fifteen minutes, which is right for
    // somebody waiting at the screen and useless for an email read tomorrow.
    expect(days).toBe(30);
  });

  it('marks each member before handing the email over', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async () => {
      order.push('marked');
      return [];
    });
    email.sendRaw.mockImplementation(async () => {
      order.push('sent');
      return true;
    });

    await service.sendSignInLinks('org-1');

    // `EmailService` swallows failures, so a marker can only honestly mean we
    // tried. A member missed once beats a roster emailed twice.
    expect(order).toEqual(['marked', 'sent', 'marked', 'sent']);
  });

  it('shows the list without sending when asked to look first', async () => {
    const result = await service.sendSignInLinks('org-1', { dryRun: true });

    expect(result).toEqual({
      sent: 0,
      remaining: 2,
      recipients: ['ada@example.com', 'bo@example.com'],
      dryRun: true,
    });
    expect(email.sendRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reports what is left, so a roster can go out in batches', async () => {
    prisma.userOrg.count.mockResolvedValue(364);

    const result = await service.sendSignInLinks('org-1');

    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(362);
  });

  it('caps a batch however large a number is asked for', async () => {
    await service.sendSignInLinks('org-1', { limit: 5000 });

    expect(prisma.userOrg.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });

  it('uses the co-op’s own words when it has written some', async () => {
    prisma.belongingEmailTemplate.findUnique.mockResolvedValue({
      subject: '{{community_name}}: your account',
      body: 'Nothing to do about your payments. {{sign_in_url}}',
    });

    await service.sendSignInLinks('org-1');
    const [, subject, html] = email.sendRaw.mock.calls[0];

    expect(subject).toBe('MaybeItsFate: your account');
    expect(html).toContain('Nothing to do about your payments');
  });

  it('writes to both addresses where a member has two', async () => {
    // The send where choosing wrong is worst: a sign-in link that arrives
    // somewhere they never look reads as MaybeOS being broken.
    await service.sendSignInLinks('org-1');

    expect(email.sendRaw.mock.calls[1][0]).toEqual({
      primary: 'bo@example.com',
      also: 'bo-forum@example.com',
    });
  });

  it('says "there" rather than nothing to somebody with no name', async () => {
    await service.sendSignInLinks('org-1');

    expect(email.sendRaw.mock.calls[1][2]).toContain('there');
  });
});

/**
 * The send has to fit inside a Netlify function (MEM-23).
 *
 * Found during the pre-flight for MaybeItsFate's real send, with 435 people
 * waiting. A batch of a hundred, each costing two writes, a render and a call
 * to Postmark, is thirty to sixty seconds against a ten-second limit — and
 * the mark goes in *before* the email goes out, so anybody killed mid-flight
 * is recorded as sent, never emailed, and skipped by every retry afterwards.
 * One person in four hundred silently never gets their way in, with nothing
 * to say which one.
 */
describe('a roster that does not fit in one request', () => {
  let service: MemberService;
  let prisma: any;
  let email: any;

  const manyWaiting = Array.from({ length: 100 }, (_, i) => ({
    id: `m${i}`,
    userId: `u${i}`,
    altEmail: null,
    user: { email: `member${i}@example.com`, name: `Member ${i}` },
  }));

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', name: 'MaybeItsFate', inviteExpiryDays: 30 }),
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue(manyWaiting),
        count: jest.fn().mockResolvedValue(435),
        update: jest.fn(),
      },
      user: { update: jest.fn() },
      belongingEmailTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    // A provider that takes time, which is the whole point.
    email = {
      sendRaw: jest.fn().mockImplementation(async () => {
        jest.advanceTimersByTime(400);
        return true;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn() } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  afterEach(() => jest.useRealTimers());

  it('stops on the clock rather than running past the function limit', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    const result = await service.sendSignInLinks('org-1');

    // Well short of a hundred, and short of ten seconds' worth.
    expect(result.sent).toBeLessThan(100);
    expect(result.sent).toBeGreaterThan(0);
    expect(email.sendRaw.mock.calls.length).toBe(result.sent);
  });

  it('says how many are still waiting, so the next press continues', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    const result = await service.sendSignInLinks('org-1');

    // `signInSentAt` is the cursor: the next call asks for whoever is still
    // null and carries on from there.
    expect(result.remaining).toBe(435 - result.sent);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('leaves itself room, rather than stopping exactly on the limit', () => {
    // Netlify kills at ten seconds. Stopping at ten would mean the last
    // member of a batch is the one that gets killed part-way through.
    expect(MemberService.signInDeadlineMs).toBeLessThan(10_000);
  });
});
