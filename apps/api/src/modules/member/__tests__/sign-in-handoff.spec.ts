import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { AuditService } from '../../platform/audit.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { HANDOFF_MAX_DAYS, handoffExpiry, handoffUrl } from '../sign-in-handoff';

/**
 * A way in that is not email (MEM-29).
 *
 * Microsoft accepts MaybeOS mail with a clean `250` and then suppresses it —
 * Postmark says `Delivered`, the member's inbox and junk folder are both
 * empty. Every member on Outlook, Hotmail or a strict Microsoft 365 tenant is
 * therefore unreachable by email, and a magic link is email.
 *
 * The failures worth pinning are the ones that would be found late: an
 * organiser handed a link to somebody else's member, a capability that signs
 * in as a member leaving no record, and the audit column being marked for a
 * message nobody sent — which is exactly how MEM-25 began.
 */
describe('handing a member a sign-in link', () => {
  let service: MemberService;
  let prisma: any;
  let audit: any;

  const MEMBER = {
    id: 'm1',
    userId: 'u1',
    orgId: 'org-1',
    user: { id: 'u1', name: 'Ruth' },
  };

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', inviteExpiryDays: 7 }),
      },
      userOrg: { findFirst: jest.fn().mockResolvedValue(MEMBER), update: jest.fn() },
      user: { update: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendRaw: jest.fn() } },
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn() } },
        { provide: AuditService, useValue: audit },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('returns a link carrying the token it just stored', async () => {
    const result = await service.createSignInLink('org-1', 'u1', 'admin-1');

    const stored = prisma.user.update.mock.calls[0][0].data.magicLinkToken;
    expect(stored).toBeTruthy();
    expect(result.url).toBe(`https://maybeos.org/magic-link?token=${stored}`);
    expect(result.memberName).toBe('Ruth');
  });

  /**
   * A fresh one every time.
   *
   * A token that does not change is a permanent key to that account, and one
   * that leaks once never stops working. The URL assertion above would hold
   * for a hard-coded token, so the freshness has to be asserted on its own.
   */
  it('mints a new token on each call', async () => {
    await service.createSignInLink('org-1', 'u1', 'admin-1');
    await service.createSignInLink('org-1', 'u1', 'admin-1');

    const [first, second] = prisma.user.update.mock.calls.map(
      (call: any[]) => call[0].data.magicLinkToken,
    );

    expect(first).not.toBe(second);
    // Guessable is as bad as reused: a counter would also differ each time.
    for (const token of [first, second]) {
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('stores the expiry it reports', async () => {
    const result = await service.createSignInLink('org-1', 'u1', 'admin-1');

    expect(prisma.user.update.mock.calls[0][0].data.magicLinkExpiry).toEqual(result.expiresAt);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * The column means "MaybeOS wrote to this person", and the audit reconciles
   * it against what Postmark accepted. Marking it for a link nobody emailed
   * would have the next audit find no message, file the member under
   * "the provider swallowed it", and email them a second link.
   */
  it('does not mark the member as having been emailed', async () => {
    await service.createSignInLink('org-1', 'u1', 'admin-1');

    const wrote = prisma.userOrg.update.mock.calls
      .map((call: any[]) => call[0]?.data ?? {})
      .flatMap((data: Record<string, unknown>) => Object.keys(data));

    expect(wrote).not.toContain('signInSentAt');
    expect(wrote).not.toContain('signInDeliveredAt');
  });

  describe('scoping', () => {
    it('looks the member up by org as well as by id (SEC-04)', async () => {
      await service.createSignInLink('org-1', 'u1', 'admin-1');

      expect(prisma.userOrg.findFirst.mock.calls[0][0].where).toEqual({
        orgId: 'org-1',
        userId: 'u1',
      });
    });

    it('refuses somebody who is not a member of this co-op', async () => {
      prisma.userOrg.findFirst.mockResolvedValue(null);

      await expect(service.createSignInLink('org-1', 'u9', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('the record of it', () => {
    it('writes an audit entry naming the organiser who asked', async () => {
      await service.createSignInLink('org-1', 'u1', 'admin-1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          actorId: 'admin-1',
          action: 'member.sign_in_link.created',
          entityType: 'user',
          entityId: 'u1',
        }),
      );
    });

    /** The link is the whole risk; it must not be handed over unrecorded. */
    it('records it before returning the link', async () => {
      const order: string[] = [];
      prisma.user.update.mockImplementation(async () => void order.push('mint'));
      audit.record.mockImplementation(async () => void order.push('audit'));

      await service.createSignInLink('org-1', 'u1', 'admin-1');

      expect(order).toEqual(['mint', 'audit']);
    });

    /**
     * Not merely started before returning — finished.
     *
     * The ordering test above holds for an unawaited `void this.audit.record()`
     * too, and that is a different thing in production: this runs in a Netlify
     * function, whose container may be frozen the instant the response is
     * written. A record that was only started is a link handed over with no
     * trace of who asked for it.
     */
    it('does not return the link until the record has been written', async () => {
      let finishAudit!: () => void;
      audit.record.mockImplementation(
        () => new Promise<void>((resolve) => { finishAudit = resolve; }),
      );

      let returned = false;
      const pending = service
        .createSignInLink('org-1', 'u1', 'admin-1')
        .then((result) => { returned = true; return result; });

      // Everything that can proceed without the audit write, proceeds.
      await new Promise((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);

      finishAudit();
      await expect(pending).resolves.toHaveProperty('url');
    });

    it('keeps addresses out of the co-op’s audit log', async () => {
      await service.createSignInLink('org-1', 'u1', 'admin-1');

      const metadata = JSON.stringify(audit.record.mock.calls[0][0].metadata ?? {});
      expect(metadata).not.toMatch(/@/);
    });

    /** A link in an audit log is a live link, readable by every organiser. */
    it('never writes the token or the link into the audit entry', async () => {
      await service.createSignInLink('org-1', 'u1', 'admin-1');

      const token = prisma.user.update.mock.calls[0][0].data.magicLinkToken;
      const entry = JSON.stringify(audit.record.mock.calls[0][0]);

      expect(entry).not.toContain(token);
      expect(entry).not.toContain('magic-link?token=');
    });
  });

  describe('how long it lives', () => {
    it('caps a generous co-op setting at the handoff limit', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', inviteExpiryDays: 90 });

      const result = await service.createSignInLink('org-1', 'u1', 'admin-1');
      const days = (result.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);

      expect(days).toBeLessThanOrEqual(HANDOFF_MAX_DAYS);
      expect(days).toBeGreaterThan(HANDOFF_MAX_DAYS - 0.01);
    });

    it('keeps a shorter co-op setting rather than extending it', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', inviteExpiryDays: 2 });

      const result = await service.createSignInLink('org-1', 'u1', 'admin-1');
      const days = (result.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);

      expect(days).toBeLessThanOrEqual(2);
      expect(days).toBeGreaterThan(1.99);
    });
  });
});

describe('the handoff window', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const days = (d: Date) => (d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

  it.each([
    [1, 1],
    [7, 7],
    [30, HANDOFF_MAX_DAYS],
    [90, HANDOFF_MAX_DAYS],
  ])('turns a setting of %s days into %s', (configured, expected) => {
    expect(days(handoffExpiry(now, configured))).toBe(expected);
  });

  /** An Invalid Date compares false against everything, so it never expires. */
  it.each([
    ['not a number', Number.NaN],
    ['zero', 0],
    ['negative', -5],
  ])('still ends the window when the setting is %s', (_why, configured) => {
    const expiry = handoffExpiry(now, configured);

    expect(Number.isNaN(expiry.getTime())).toBe(false);
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
    expect(days(expiry)).toBeLessThanOrEqual(HANDOFF_MAX_DAYS);
  });
});

describe('the link', () => {
  it('does not double the slash when the base url has a trailing one', () => {
    expect(handoffUrl('https://maybeos.org/', 'abc')).toBe('https://maybeos.org/magic-link?token=abc');
  });

  it('escapes a token rather than letting it add query parameters', () => {
    expect(handoffUrl('https://maybeos.org', 'a&b=c')).toBe(
      'https://maybeos.org/magic-link?token=a%26b%3Dc',
    );
  });
});
