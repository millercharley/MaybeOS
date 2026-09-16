import { DOOR_WORDS } from '../door-words';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DoorService } from '../door.service';
import { DoorScriptService } from '../door-script.service';
import { DOOR_ACCESS_WHERE, hasDoorAccess } from '../door-access-rule';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { UpdateOrgDto } from '../../org/dto/update-org.dto';
import { SetDoorScriptDto } from '../dto/door-script.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';
import { isSealed, seal } from '../../../common/secret-box';

/**
 * Issuing door codes and keeping the co-op's door sheet in step (DOR-01).
 *
 * The rules worth holding:
 * - a cancelled member is revoked in the sheet;
 * - someone removed from the co-op is revoked even though their membership
 *   row is gone;
 * - a row is recorded as written only after the script accepts it;
 * - the sync can only be pointed at an Apps Script web app.
 * Each failure ends the same way: the wrong person at the door with a code
 * that works, or the right person with one that does not.
 */

const ORG = 'org-1';
const URL = 'https://script.google.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAXeXMJe9c0QQ3aOpACaxyG2KvJHFyX5XFTi22Ce9uldR1lA/exec';
const ROLES = ['ADMIN', 'STAFF', 'MEMBER', 'GUEST'] as const;
const STATUSES = ['NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'COMP'] as const;

type Row = { role: (typeof ROLES)[number]; subscriptionStatus: (typeof STATUSES)[number] };

/** Evaluates the Prisma filter the way the database would, for this filter's shape. */
function matchesWhere(row: Row): boolean {
  return DOOR_ACCESS_WHERE.OR.some((clause) => {
    const role = clause.role as unknown as string | { in: string[] };
    const roleOk = typeof role === 'string' ? row.role === role : role.in.includes(row.role);
    const status = (clause as { subscriptionStatus?: { not: string } }).subscriptionStatus;
    return roleOk && (!status || row.subscriptionStatus !== status.not);
  });
}

describe('who may open the door', () => {
  it('admins and staff always, members unless cancelled, guests never', () => {
    expect(hasDoorAccess({ role: 'ADMIN', subscriptionStatus: 'CANCELED' })).toBe(true);
    expect(hasDoorAccess({ role: 'STAFF', subscriptionStatus: 'CANCELED' })).toBe(true);
    expect(hasDoorAccess({ role: 'MEMBER', subscriptionStatus: 'ACTIVE' })).toBe(true);
    expect(hasDoorAccess({ role: 'MEMBER', subscriptionStatus: 'PAST_DUE' })).toBe(true);
    // The $0 members outside Stripe, until the migration moves them in.
    expect(hasDoorAccess({ role: 'MEMBER', subscriptionStatus: 'NONE' })).toBe(true);
    expect(hasDoorAccess({ role: 'MEMBER', subscriptionStatus: 'CANCELED' })).toBe(false);
    expect(hasDoorAccess({ role: 'GUEST', subscriptionStatus: 'ACTIVE' })).toBe(false);
  });

  it('the database filter and the function agree on every role and status', () => {
    for (const role of ROLES) {
      for (const subscriptionStatus of STATUSES) {
        expect([role, subscriptionStatus, matchesWhere({ role, subscriptionStatus })]).toEqual([
          role,
          subscriptionStatus,
          hasDoorAccess({ role, subscriptionStatus }),
        ]);
      }
    }
  });
});

describe('DoorService', () => {
  let service: DoorService;
  let prisma: {
    organization: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    userOrg: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    doorSheetEntry: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let script: { upsert: jest.Mock; ping: jest.Mock };
  let email: { sendDoorCode: jest.Mock };

  const org = (over: Record<string, unknown> = {}) => ({
    id: ORG,
    name: 'MaybeItsFate',
    slug: 'maybeitsfate',
    doorAccessEnabled: true,
    doorCodeEmailsEnabled: false,
    doorScriptUrl: URL,
    doorScriptSecret: seal('the-secret'),
    ...over,
  });

  const member = (over: Record<string, unknown> = {}, user: Record<string, unknown> = {}) => ({
    id: 'm1',
    role: 'MEMBER',
    subscriptionStatus: 'ACTIVE',
    doorPin: 'ABCDE',
    doorPinSyncedAt: null,
    user: { email: 'Ada@Example.com', name: 'Ada Lovelace', ...user },
    ...over,
  });

  const entry = (over: Record<string, unknown> = {}) => ({
    orgId: ORG,
    email: 'ada@example.com',
    doorPin: 'ABCDE',
    name: 'Ada Lovelace',
    revoked: false,
    ...over,
  });

  const sentRows = () => script.upsert.mock.calls.flatMap((call) => call[2]);

  beforeAll(() => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 3).toString('base64');
  });
  afterAll(() => {
    delete process.env.SECRET_BOX_KEY;
  });

  beforeEach(async () => {
    script = {
      upsert: jest.fn().mockResolvedValue({ added: 0, updated: 0, unchanged: 0, rejected: 0 }),
      ping: jest.fn().mockResolvedValue({ members: 3 }),
    };
    email = { sendDoorCode: jest.fn() };
    prisma = {
      organization: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(org()),
        update: jest.fn().mockResolvedValue({}),
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      doorSheetEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args) => args),
        deleteMany: jest.fn((args) => args),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoorService,
        { provide: DoorScriptService, useValue: script },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DoorService);
  });

  describe('issuing codes', () => {
    it('only to members who may open the door', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

      expect(await service.issuePins(ORG)).toBe(2);
      expect(prisma.userOrg.findMany.mock.calls[0][0].where).toMatchObject({
        orgId: ORG,
        doorPin: null,
        ...DOOR_ACCESS_WHERE,
      });
      expect(prisma.userOrg.update.mock.calls[0][0].data.doorPin).toMatch(/^[ABCDEFGHJKMNOPQRSTUVWXYZ]{5}$/);
    });

    it('gives each member a word they can remember (DOR-01)', async () => {
      prisma.userOrg.findMany
        .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }])
        .mockResolvedValueOnce([]);

      await service.issuePins(ORG);

      for (const call of prisma.userOrg.update.mock.calls) {
        expect(DOOR_WORDS).toContain(call[0].data.doorPin);
      }
    });

    it('never hands out a word the co-op is already using', async () => {
      // Everything but one word is taken, so there is only one answer left.
      const free = DOOR_WORDS[DOOR_WORDS.length - 1];
      prisma.userOrg.findMany
        .mockResolvedValueOnce([{ id: 'm1' }])
        .mockResolvedValueOnce(DOOR_WORDS.slice(0, -1).map((doorPin) => ({ doorPin })));

      await service.issuePins(ORG);

      expect(prisma.userOrg.update.mock.calls[0][0].data.doorPin).toBe(free);
    });

    it('tries again when the letters are already taken in this co-op', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }]);
      prisma.userOrg.update
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        .mockResolvedValueOnce({});

      expect(await service.issuePins(ORG)).toBe(1);
      expect(prisma.userOrg.update).toHaveBeenCalledTimes(2);
    });

    it('does not swallow a real database failure', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }]);
      prisma.userOrg.update.mockRejectedValue(new Error('connection lost'));

      await expect(service.issuePins(ORG)).rejects.toThrow('connection lost');
    });
  });

  describe('updating the sheet', () => {
    const sync = (opts?: { full?: boolean }) =>
      service.syncSheet({ id: ORG, doorScriptUrl: URL }, 'the-secret', opts);

    it('sends a new member with a lowercased email, and records them after the script accepts', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member()]);

      expect(await sync()).toBe(1);
      expect(script.upsert).toHaveBeenCalledWith(URL, 'the-secret', [
        { email: 'ada@example.com', code: 'ABCDE', name: 'Ada Lovelace', revoked: false },
      ]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.userOrg.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m1'] } },
        data: { doorPinSyncedAt: expect.any(Date) },
      });
    });

    it('marks a member cancelled in Stripe as revoked', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member({ subscriptionStatus: 'CANCELED' })]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry()]);

      await sync();
      expect(sentRows()).toEqual([expect.objectContaining({ email: 'ada@example.com', revoked: true })]);
    });

    it('marks someone removed from the co-op as revoked, though their membership is gone', async () => {
      prisma.userOrg.findMany.mockResolvedValue([]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry({ email: 'gone@example.com', doorPin: 'GONEX' })]);

      await sync();
      expect(sentRows()).toEqual([
        { email: 'gone@example.com', code: 'GONEX', name: 'Ada Lovelace', revoked: true },
      ]);
    });

    it('revokes the old address when a member changes their email', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member({}, { email: 'new@example.com' })]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry({ email: 'old@example.com' })]);

      await sync();
      expect(sentRows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ email: 'new@example.com', revoked: false }),
          expect.objectContaining({ email: 'old@example.com', revoked: true }),
        ]),
      );
    });

    it('sends nothing when the sheet already matches', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member({ doorPinSyncedAt: new Date() })]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry()]);

      expect(await sync()).toBe(0);
      expect(script.upsert).not.toHaveBeenCalled();
    });

    it('resends everything on a full sync, which repairs a hand-edited sheet', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member({ doorPinSyncedAt: new Date() })]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry()]);

      expect(await sync({ full: true })).toBe(1);
    });

    it('sends a new code, and a member with no name as an empty name', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member({ doorPin: 'NEWCD' }, { name: null })]);
      prisma.doorSheetEntry.findMany.mockResolvedValue([entry()]);

      await sync();
      expect(sentRows()).toEqual([{ email: 'ada@example.com', code: 'NEWCD', name: '', revoked: false }]);
    });

    it('records nothing, and marks nobody synced, when the script refuses', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member()]);
      script.upsert.mockRejectedValue(new Error('unauthorized'));

      await expect(sync()).rejects.toThrow('unauthorized');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.userOrg.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('telling members', () => {
    it('only members who may open the door and whose row is in the sheet', async () => {
      await service.emailPending(org());
      expect(prisma.userOrg.findMany.mock.calls[0][0].where).toMatchObject({
        doorPinSyncedAt: { not: null },
        doorPinEmailedAt: null,
        ...DOOR_ACCESS_WHERE,
      });
    });

    it('emails nobody until the co-op turns emails on', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member()]);
      await service.syncOrg(ORG);
      expect(email.sendDoorCode).not.toHaveBeenCalled();
    });
  });

  describe('a co-op that has not finished setting up', () => {
    it.each([
      ['switched off', { doorAccessEnabled: false }],
      ['no script address', { doorScriptUrl: null }],
      ['no secret', { doorScriptSecret: null }],
    ])('does nothing when %s', async (_label, over) => {
      prisma.organization.findUnique.mockResolvedValue(org(over));
      expect(await service.syncOrg(ORG)).toEqual({ issued: 0, synced: 0, emailed: 0 });
      expect(script.upsert).not.toHaveBeenCalled();
      expect(prisma.userOrg.update).not.toHaveBeenCalled();
    });
  });

  it('one co-op failing does not stop the next co-op’s door', async () => {
    prisma.organization.findMany.mockResolvedValue([
      { id: 'broken', slug: 'broken' },
      { id: ORG, slug: 'maybeitsfate' },
    ]);
    prisma.organization.findUnique.mockImplementation(({ where }) =>
      where.id === 'broken' ? Promise.reject(new Error('boom')) : Promise.resolve(org()),
    );
    prisma.userOrg.findMany.mockResolvedValue([member()]);

    const totals = await service.runDue();
    expect(totals.synced).toBe(1);
  });

  describe('a member’s own code', () => {
    it('is hidden once they are cancelled, since it no longer opens the door', async () => {
      prisma.userOrg.findFirst.mockResolvedValue({ doorPin: 'ABCDE', role: 'MEMBER', subscriptionStatus: 'CANCELED' });
      expect(await service.pinFor(ORG, 'u1')).toEqual({ doorPin: null });
    });

    it('is shown to a member in good standing', async () => {
      prisma.userOrg.findFirst.mockResolvedValue({ doorPin: 'ABCDE', role: 'MEMBER', subscriptionStatus: 'PAST_DUE' });
      expect(await service.pinFor(ORG, 'u1')).toEqual({ doorPin: 'ABCDE' });
    });
  });

  it('replacing a code queues a rewrite of the sheet and a fresh email', async () => {
    prisma.userOrg.findFirst.mockResolvedValue({ id: 'm1' });
    const { doorPin } = await service.regenerate(ORG, 'user-1');
    expect(doorPin).toMatch(/^[ABCDEFGHJKMNOPQRSTUVWXYZ]{5}$/);
    expect(prisma.userOrg.update.mock.calls[0][0].data).toMatchObject({
      doorPinSyncedAt: null,
      doorPinEmailedAt: null,
    });
  });

  describe('setting up the script', () => {
    it.each([
      'https://evil.example.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAX/exec',
      'http://script.google.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAX/exec',
      'https://script.google.com.evil.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAX/exec',
      `${URL}?next=https://evil.example.com`,
      'https://script.google.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAX/dev',
    ])('refuses an address that is not an Apps Script web app: %s', async (bad) => {
      await expect(service.setScriptUrl(ORG, bad)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a different script clears the record, so the new sheet gets everyone', async () => {
      prisma.organization.findUnique.mockResolvedValue(org({ doorScriptUrl: null }));
      await service.setScriptUrl(ORG, ` ${URL} `);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: ORG }, data: { doorScriptUrl: URL } });
      expect(prisma.doorSheetEntry.deleteMany).toHaveBeenCalledWith({ where: { orgId: ORG } });
    });

    it('saving the same address changes nothing', async () => {
      await service.setScriptUrl(ORG, URL);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('stores a new secret sealed, returns it once, and setup never shows it', async () => {
      const { secret } = await service.rotateSecret(ORG);
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const stored = prisma.organization.update.mock.calls[0][0].data.doorScriptSecret;
      expect(isSealed(stored)).toBe(true);
      expect(JSON.stringify(stored)).not.toContain(secret);

      const setup = await service.setup(ORG);
      expect(setup).toEqual({ scriptUrl: URL, secretSet: true });
      expect(JSON.stringify(setup)).not.toContain('the-secret');
    });

    it('tests the connection with the stored secret', async () => {
      expect(await service.test(ORG)).toEqual({ members: 3 });
      expect(script.ping).toHaveBeenCalledWith(URL, 'the-secret');
    });
  });
});

describe('door settings through the validation whitelist', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  it('accepts the switches the Settings page sends', async () => {
    await expect(
      pipe.transform({ doorAccessEnabled: true, doorCodeEmailsEnabled: false }, { type: 'body', metatype: UpdateOrgDto }),
    ).resolves.toMatchObject({ doorAccessEnabled: true });
  });

  it('accepts a script address, and null to clear it', async () => {
    await expect(
      pipe.transform({ url: URL }, { type: 'body', metatype: SetDoorScriptDto }),
    ).resolves.toMatchObject({ url: URL });
    await expect(
      pipe.transform({ url: null }, { type: 'body', metatype: SetDoorScriptDto }),
    ).resolves.toMatchObject({ url: null });
  });
});
