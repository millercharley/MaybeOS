import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { AuditService } from '../../platform/audit.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Correcting a dead address (MEM-25).
 *
 * The other half of the bounce list. Derek's address hard-bounced — "the
 * address does not exist" — and flagging that while offering only "try again"
 * is a loop with no way out: clear the flag, send again, bounce again.
 *
 * What makes it worth testing is that `user.email` is a credential. It is what
 * the member signs in with and where a magic link is sent, so the refusals
 * below are not validation niceties; each one is a way this could go wrong
 * quietly.
 */
describe('correcting a member’s address', () => {
  let service: MemberService;
  let prisma: any;
  let audit: any;

  const MEMBERSHIP = {
    id: 'm1',
    user: { id: 'u1', email: 'derekmatt@me.com', name: 'Derek Matt' },
  };

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findFirst: jest.fn().mockResolvedValue(MEMBERSHIP),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    audit = { record: jest.fn() };

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

  it('writes the corrected address, lowercased and trimmed', async () => {
    const result = await service.updateMemberIdentity('org-1', 'u1', { email: '  Derek@Example.COM ' }, 'admin-1');

    expect(result).toEqual({ changed: true, email: 'derek@example.com' });

    const [userWrite] = prisma.user.update.mock.calls[0];
    expect(userWrite.data.email).toBe('derek@example.com');
  });

  it('gives the new address a clean slate', async () => {
    await service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1');

    const [membershipWrite] = prisma.userOrg.update.mock.calls[0];

    // Nothing has ever been sent *here*. The bounce belonged to the old
    // address, and leaving it would keep this member out of every re-send.
    expect(membershipWrite.data).toMatchObject({
      signInSentAt: null,
      signInDeliveredAt: null,
      signInBouncedAt: null,
      signInBounceKind: null,
      signInAuditedAt: null,
    });
  });

  it('stops treating the old address’s verification as proof of the new one', async () => {
    await service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1');

    const [userWrite] = prisma.user.update.mock.calls[0];
    expect(userWrite.data.emailVerified).toBe(false);
    // Any link already in flight pointed at an address that bounced.
    expect(userWrite.data.magicLinkToken).toBeNull();
  });

  it('refuses an address another account already holds', async () => {
    // The column is unique, so the write would fail regardless — this says
    // which address and why, instead of surfacing a constraint violation.
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', _count: { orgs: 1 } });

    const result = await service.updateMemberIdentity('org-1', 'u1', { email: 'taken@example.com' }, 'admin-1');

    expect(result).toMatchObject({ changed: false, reason: 'taken' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to change a login that spans more than one co-op', async () => {
    // One sign-in covers every community somebody belongs to, so this admin
    // would be changing how they get into one they have nothing to do with.
    prisma.userOrg.count.mockResolvedValue(1);

    const result = await service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1');

    expect(result).toMatchObject({ changed: false, reason: 'shared-login' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the address it already is, rather than reporting a fix', async () => {
    const result = await service.updateMemberIdentity('org-1', 'u1', { email: 'DerekMatt@me.com' }, 'admin-1');

    expect(result).toMatchObject({ changed: false, reason: 'unchanged' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scopes the lookup to this co-op', async () => {
    await service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1');

    // Never findUnique on the userId alone: a membership is tenant-owned, and
    // one co-op must not reach into another's roster (SEC-04).
    expect(prisma.userOrg.findFirst.mock.calls[0][0].where).toEqual({
      orgId: 'org-1',
      userId: 'u1',
    });
  });

  it('leaves a line in the log the co-op can read about itself', async () => {
    await service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1');

    // An admin who can change where a magic link is sent can send it somewhere
    // they read. A reasonable power; not one to leave no trace of (PLT-01).
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        actorId: 'admin-1',
        action: 'member.identity_changed',
        metadata: { emailFrom: 'derekmatt@me.com', emailTo: 'derek@example.com' },
      }),
    );
  });

  it('records nothing when it refused', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', _count: { orgs: 1 } });
    await service.updateMemberIdentity('org-1', 'u1', { email: 'taken@example.com' }, 'admin-1');

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('tells a live account apart from one that was removed', async () => {
    /*
      The dead end this fixes (MEM-28).

      Removing a member deletes their membership and leaves their account, so
      the thing holding an address is often a husk rather than a second member
      — and "check whether they have two accounts here" is advice that cannot
      be followed when one of them is the account you removed five minutes ago.
    */
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', _count: { orgs: 0 } });

    await expect(
      service.updateMemberIdentity('org-1', 'u1', { email: 'taken@example.com' }, 'admin-1'),
    ).resolves.toMatchObject({ changed: false, reason: 'held-by-removed' });
  });

  describe('the name half', () => {
    it('corrects the name without touching anything else', async () => {
      // The common case: a roster out of a spreadsheet, full of "SMITH, JANE".
      const result = await service.updateMemberIdentity(
        'org-1',
        'u1',
        { name: 'Derek Matthews' },
        'admin-1',
      );

      expect(result).toEqual({ changed: true, name: 'Derek Matthews' });

      const [userWrite] = prisma.user.update.mock.calls[0];
      expect(userWrite.data.name).toBe('Derek Matthews');
      // Not a new address, so none of the address machinery fires.
      expect(userWrite.data).not.toHaveProperty('email');
      expect(userWrite.data).not.toHaveProperty('emailVerified');
      expect(userWrite.data).not.toHaveProperty('magicLinkToken');
    });

    it('does not reset what we know about reaching them', async () => {
      /*
        The mistake worth guarding.

        Correcting a spelling does not mean their sign-in link never arrived.
        Clearing the record here would put a perfectly reachable member back
        into the queue to be written to again — four hundred of those is the
        whole reason the audit exists.
      */
      await service.updateMemberIdentity('org-1', 'u1', { name: 'Derek Matthews' }, 'admin-1');

      expect(prisma.userOrg.update).not.toHaveBeenCalled();
    });

    it('is allowed for somebody who belongs to more than one co-op', async () => {
      // A name travels across communities too, but changing it takes nobody's
      // account anywhere. Only the credential is refused.
      prisma.userOrg.count.mockResolvedValue(1);

      await expect(
        service.updateMemberIdentity('org-1', 'u1', { name: 'Derek Matthews' }, 'admin-1'),
      ).resolves.toMatchObject({ changed: true });
    });

    it('still refuses the address for that person', async () => {
      prisma.userOrg.count.mockResolvedValue(1);

      await expect(
        service.updateMemberIdentity('org-1', 'u1', { email: 'derek@example.com' }, 'admin-1'),
      ).resolves.toMatchObject({ changed: false, reason: 'shared-login' });
    });

    it('changes both in one write when both are given', async () => {
      const result = await service.updateMemberIdentity(
        'org-1',
        'u1',
        { name: 'Derek Matthews', email: 'derek@example.com' },
        'admin-1',
      );

      expect(result).toEqual({
        changed: true,
        name: 'Derek Matthews',
        email: 'derek@example.com',
      });

      const [userWrite] = prisma.user.update.mock.calls[0];
      expect(userWrite.data).toMatchObject({
        name: 'Derek Matthews',
        email: 'derek@example.com',
      });
      // And the address half does reset the sign-in record.
      expect(prisma.userOrg.update).toHaveBeenCalled();
    });

    it('says nothing changed when the name is the one they already have', async () => {
      // A no-op reporting success looks like a fix that did not take.
      await expect(
        service.updateMemberIdentity('org-1', 'u1', { name: '  Derek Matt  ' }, 'admin-1'),
      ).resolves.toMatchObject({ changed: false, reason: 'unchanged' });
    });

    it('says nothing changed when nothing was sent at all', async () => {
      await expect(
        service.updateMemberIdentity('org-1', 'u1', {}, 'admin-1'),
      ).resolves.toMatchObject({ changed: false, reason: 'unchanged' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records the name it replaced, as well as the one it set', async () => {
      await service.updateMemberIdentity('org-1', 'u1', { name: 'Derek Matthews' }, 'admin-1');

      expect(audit.record.mock.calls[0][0].metadata).toEqual({
        nameFrom: 'Derek Matt',
        nameTo: 'Derek Matthews',
      });
    });
  });

  it('refuses somebody who is not in this co-op', async () => {
    prisma.userOrg.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMemberIdentity('org-1', 'stranger', { email: 'derek@example.com' }, 'admin-1'),
    ).rejects.toThrow('Member not found');
  });
});
