import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BelongingSettingsService } from '../belonging-settings.service';
import { BuddyService } from '../buddy.service';

/**
 * The Buddy System's acceptance criteria (PRD §8.1–§8.3), driven through the
 * service rather than asserted about its parts.
 *
 * The rotation is proven separately and exhaustively in `buddy-rotation.spec`.
 * What is proven here is the machine around it: that "off" means off, that
 * exactly one person is on the hook at a time, and that nobody is left
 * wondering whether they still owe the community something.
 */
describe('BuddyService', () => {
  let prisma: any;
  let email: any;
  let service: BuddyService;

  const settingsRow = (over: Record<string, unknown> = {}) => ({
    orgId: 'org1',
    buddySystemEnabled: true,
    buddyInviteTimeoutHours: 48,
    buddyAskCooldownDays: 30,
    buddyServeCooldownDays: 90,
    buddyMaxActivePairings: 1,
    buddyFallbackAdminId: null,
    knowledgeCenterEnabled: false,
    requiredReadingGraceDays: 14,
    ...over,
  });

  const poolMember = (id: string) => ({
    id,
    buddyStats: null,
    _count: { buddyPairingsAsBuddy: 0, buddyInvitations: 0 },
  });

  const pairingRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    orgId: 'org1',
    newMemberId: 'new1',
    state: 'SEEKING',
    org: { id: 'org1', name: 'Sunrise', slug: 'sunrise' },
    newMember: { userId: 'u-new', user: { name: 'Ada', email: 'ada@example.org' } },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      belongingSettings: {
        findUnique: jest.fn().mockResolvedValue(settingsRow()),
        upsert: jest.fn().mockResolvedValue(settingsRow()),
        update: jest.fn(),
      },
      buddyPairing: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(pairingRow()),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      buddyInvitation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'i1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      memberBuddyStats: { upsert: jest.fn().mockResolvedValue({}) },
      belongingEmailTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      userOrg: {
        findMany: jest.fn().mockResolvedValue([poolMember('m1'), poolMember('m2')]),
        findUnique: jest.fn().mockResolvedValue({ user: { email: 'm1@example.org' } }),
        findFirst: jest.fn().mockResolvedValue({ id: 'admin1' }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    email = { sendRaw: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuddyService,
        BelongingSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(BuddyService);
  });

  describe('with the tool off, nothing happens at all (§8.1)', () => {
    beforeEach(() => {
      prisma.belongingSettings.findUnique.mockResolvedValue(settingsRow({ buddySystemEnabled: false }));
    });

    it('creates no pairing', async () => {
      await expect(service.onMemberJoined('org1', 'new1')).resolves.toBeNull();
      expect(prisma.buddyPairing.create).not.toHaveBeenCalled();
    });

    it('sends no email', async () => {
      await service.onMemberJoined('org1', 'new1');
      expect(email.sendRaw).not.toHaveBeenCalled();
    });
  });

  describe('with it on, one ask at a time (§8.2)', () => {
    it('creates a pairing and asks exactly one person', async () => {
      await service.onMemberJoined('org1', 'new1');

      expect(prisma.buddyPairing.create).toHaveBeenCalledTimes(1);
      expect(prisma.buddyInvitation.create).toHaveBeenCalledTimes(1);
      expect(email.sendRaw).toHaveBeenCalledTimes(1);
    });

    it('records the ask whether or not it is ever answered', async () => {
      // §5.2: this is what makes the rotation real.
      await service.onMemberJoined('org1', 'new1');

      expect(prisma.memberBuddyStats.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ timesAsked: { increment: 1 } }),
        }),
      );
    });

    it('stores only a hash of the token', async () => {
      await service.onMemberJoined('org1', 'new1');

      const data = prisma.buddyInvitation.create.mock.calls[0][0].data;
      // The link is emailed and works without a login. A database read must
      // not yield a working accept link.
      expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data).not.toHaveProperty('token');

      const sentHtml = email.sendRaw.mock.calls[0][2] as string;
      const tokenInEmail = sentHtml.match(/\/buddy\/([0-9a-f]{64})/)?.[1];
      expect(tokenInEmail).toBeDefined();
      expect(tokenInEmail).not.toBe(data.tokenHash);
    });

    it('does not ask a second person while one is still deciding', async () => {
      prisma.buddyInvitation.findFirst.mockResolvedValue({ id: 'i1' });

      await expect(service.advance('p1')).resolves.toEqual({ outcome: 'already-pending' });
      expect(prisma.buddyInvitation.create).not.toHaveBeenCalled();
    });

    it('does not start a second search for a member already being matched', async () => {
      prisma.buddyPairing.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.onMemberJoined('org1', 'new1')).resolves.toBe('existing');
      expect(prisma.buddyPairing.create).not.toHaveBeenCalled();
    });

    it('hands the pairing to an admin when nobody is left', async () => {
      prisma.userOrg.findMany.mockResolvedValue([]);

      await expect(service.advance('p1')).resolves.toEqual({
        outcome: 'needs-admin',
        fallbackId: 'admin1',
      });
      expect(prisma.buddyPairing.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { state: 'NEEDS_ADMIN' } }),
      );
    });
  });

  describe('answering', () => {
    const invitationRow = (over: Record<string, unknown> = {}) => ({
      id: 'i1',
      pairingId: 'p1',
      candidateId: 'm1',
      state: 'PENDING',
      pairing: pairingRow(),
      candidate: { userId: 'u-buddy', user: { name: 'Grace', email: 'grace@example.org' } },
      ...over,
    });

    it('accepting pairs them and introduces both people (§8.5)', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(invitationRow());

      await expect(service.respond('tok', 'accept')).resolves.toMatchObject({ status: 'accepted' });

      expect(prisma.buddyPairing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'ACTIVE', buddyMemberId: 'm1' }),
        }),
      );
      expect(email.sendRaw).toHaveBeenCalledTimes(2);
    });

    it('each intro links to the same conversation, from the other side', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(invitationRow());
      await service.respond('tok', 'accept');

      const [toBuddy, toNewMember] = email.sendRaw.mock.calls;
      // The buddy's link names the new member and vice versa, so both land in
      // the composer rather than on a list of conversations.
      expect(toBuddy[2]).toContain('/messages/u-new');
      expect(toNewMember[2]).toContain('/messages/u-buddy');
    });

    it('accepting counts as service, for the next rotation', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(invitationRow());
      await service.respond('tok', 'accept');

      expect(prisma.memberBuddyStats.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ timesServed: { increment: 1 } }),
        }),
      );
    });

    it('declining moves to the next candidate immediately', async () => {
      // Not on the next sweep: an hour of waiting for no reason is an hour a
      // new member spends unmatched.
      prisma.buddyInvitation.findUnique.mockResolvedValue(invitationRow());

      await expect(service.respond('tok', 'decline')).resolves.toMatchObject({ status: 'declined' });
      expect(prisma.buddyInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'DECLINED' }) }),
      );
      expect(prisma.buddyInvitation.create).toHaveBeenCalled();
    });

    it('a stale link says "already covered" and records nothing (§5.1)', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(invitationRow({ state: 'EXPIRED' }));

      await expect(service.respond('tok', 'accept')).resolves.toEqual({ status: 'already-covered' });
      expect(prisma.buddyPairing.update).not.toHaveBeenCalled();
      expect(email.sendRaw).not.toHaveBeenCalled();
    });

    it('a late accept on a pairing somebody else took changes nothing', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(
        invitationRow({ pairing: pairingRow({ state: 'ACTIVE' }) }),
      );

      await expect(service.respond('tok', 'accept')).resolves.toEqual({ status: 'already-covered' });
      expect(prisma.buddyPairing.update).not.toHaveBeenCalled();
    });

    it('an unknown token is not an error', async () => {
      prisma.buddyInvitation.findUnique.mockResolvedValue(null);
      await expect(service.respond('nope', 'accept')).resolves.toEqual({ status: 'unknown' });
    });
  });

  describe('the sweep (§8.3)', () => {
    const expiredRow = {
      id: 'i1',
      pairingId: 'p1',
      candidateId: 'm1',
      candidate: { user: { email: 'm1@example.org' } },
      pairing: {
        orgId: 'org1',
        org: { id: 'org1', name: 'Sunrise', slug: 'sunrise' },
        newMember: { user: { name: 'Ada' } },
      },
    };

    it('always releases the non-responder before asking anyone else', async () => {
      // The criterion, and the decency: somebody who did not answer should
      // hear "nothing is owed" before they find out second-hand that
      // somebody else was asked.
      prisma.buddyInvitation.findMany
        .mockResolvedValueOnce([{ id: 'i1' }]) // overdue
        .mockResolvedValueOnce([expiredRow]); // owed an Off the Hook
      prisma.buddyPairing.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.runDueWork(new Date());

      const offTheHookAt = email.sendRaw.mock.invocationCallOrder[0];
      const nextAskAt = prisma.buddyInvitation.create.mock.invocationCallOrder[0];
      expect(offTheHookAt).toBeLessThan(nextAskAt);
    });

    it('expires only what is still pending', async () => {
      prisma.buddyInvitation.findMany.mockResolvedValueOnce([{ id: 'i1' }]).mockResolvedValueOnce([]);

      await service.runDueWork(new Date());

      // Conditional, so an accept landing in the same second wins.
      expect(prisma.buddyInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'i1', state: 'PENDING' } }),
      );
    });

    it('does not release the same person twice', async () => {
      // The stamp is what makes a retried run safe. Nobody should be told
      // twice that they are off the hook for the same ask.
      prisma.buddyInvitation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.runDueWork(new Date());
      expect(result.offTheHookSent).toBe(0);
      expect(email.sendRaw).not.toHaveBeenCalled();
    });

    it('stamps the release so a retry finds nothing to do', async () => {
      prisma.buddyInvitation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([expiredRow]);

      await service.runDueWork(new Date());
      expect(prisma.buddyInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'i1' },
          data: expect.objectContaining({ offTheHookSentAt: expect.any(Date) }),
        }),
      );
    });

    it('only sweeps co-ops that have the tool on (§8.10)', async () => {
      prisma.buddyInvitation.findMany.mockResolvedValue([]);
      await service.runDueWork(new Date());

      // Turning the tool off stops the emails without deleting history, so
      // the query filters rather than the rows being removed.
      expect(prisma.buddyPairing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            org: { belongingSettings: { buddySystemEnabled: true } },
          }),
        }),
      );
    });

    it('one stranded pairing does not stop the next', async () => {
      prisma.buddyInvitation.findMany.mockResolvedValue([]);
      prisma.buddyPairing.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
      prisma.buddyPairing.findUnique
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValue(pairingRow());

      const result = await service.runDueWork(new Date());
      expect(result.advanced).toBe(1);
    });
  });
});
