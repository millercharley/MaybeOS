import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Welcoming a new member, and not welcoming 364 old ones (MEM-17).
 *
 * `sendWelcome` sat in the email service from the beginning with no caller
 * anywhere; MaybeItsFate's welcome came from a Zapier automation wired to
 * Stripe, which announced itself on 2026-10-02 by welcoming Charley to the
 * *old* system during a test purchase in the new one.
 *
 * The rule this pins is the one that matters during a migration: a person
 * joining gets welcomed, a roster arriving does not. Welcoming 364 people to
 * a place they have belonged to for three years would be the most
 * embarrassing possible first email from a product that just replaced the
 * thing they liked.
 */
describe('welcoming a new member', () => {
  let service: MemberService;
  let prisma: any;
  let email: any;

  const ORG = { id: 'org-1', name: 'MaybeItsFate', slug: 'maybeitsfate' };
  const USER = { name: 'Ada', email: 'ada@example.com' };

  /** The async welcome is fire-and-forget, so give it a turn to run. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ ...ORG, welcomeEmailEnabled: true }) },
      user: { findUnique: jest.fn().mockResolvedValue(USER) },
    };
    email = { sendWelcome: jest.fn().mockResolvedValue(undefined) };

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

  /** The private hop the join paths call. */
  const welcome = (orgId = 'org-1', userId = 'user-1') =>
    (service as unknown as { sendWelcome(o: string, u: string): void }).sendWelcome(orgId, userId);

  it('sends in the co-op’s name, with somewhere to go', async () => {
    welcome();
    await settle();

    expect(email.sendWelcome).toHaveBeenCalledWith('ada@example.com', {
      orgName: 'MaybeItsFate',
      memberName: 'Ada',
      // A welcome with no link is a dead end.
      memberUrl: 'https://maybeos.org/member/maybeitsfate',
    });
  });

  it('sends nothing while the co-op still has its old welcome running', async () => {
    prisma.organization.findUnique.mockResolvedValue({ ...ORG, welcomeEmailEnabled: false });

    welcome();
    await settle();

    expect(email.sendWelcome).not.toHaveBeenCalled();
  });

  it('is off until somebody turns it on, which is what makes that true', () => {
    // The column defaults to false in the schema; this is the assertion that
    // a future "sensible default" change has to argue with.
    const schema = require('fs').readFileSync(
      `${__dirname}/../../../../prisma/schema.prisma`,
      'utf8',
    );

    expect(schema).toMatch(/welcomeEmailEnabled\s+Boolean\s+@default\(false\)/);
  });

  it('says "there" rather than nothing when a member has no name yet', async () => {
    prisma.user.findUnique.mockResolvedValue({ name: null, email: 'ada@example.com' });

    welcome();
    await settle();

    expect(email.sendWelcome.mock.calls[0][1].memberName).toBe('there');
  });

  it('sends nothing to somebody with no email address', async () => {
    prisma.user.findUnique.mockResolvedValue({ name: 'Ada', email: null });

    welcome();
    await settle();

    expect(email.sendWelcome).not.toHaveBeenCalled();
  });

  it('never fails the join it is attached to', async () => {
    prisma.organization.findUnique.mockRejectedValue(new Error('database went away'));

    // Not awaited by its callers, so the test is that this does not throw
    // and does not reject anything into the join's own promise.
    expect(() => welcome()).not.toThrow();
    await settle();
  });
});

/**
 * The importer must not welcome anybody, enforced by reading the source.
 *
 * The same guarantee the buddy search has, and the same reason: there is no
 * unit test that can fail when somebody wires a courtesy into the bulk path,
 * because the courtesy looks right everywhere else.
 */
describe('a roster arriving is not 364 arrivals', () => {
  const source = require('fs').readFileSync(`${__dirname}/../member.service.ts`, 'utf8');

  /** The body of `importMembers`, up to the next method. */
  const importer = (() => {
    const start = source.indexOf('async importMembers');
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start);
    const end = rest.indexOf('\n  async ', 1);
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it('does not welcome', () => {
    expect(importer).not.toMatch(/sendWelcome/);
  });

  it('does not start a buddy search either, which is the precedent for it', () => {
    expect(importer).not.toMatch(/startBuddySearch/);
  });
});
