import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DoorService } from '../door.service';
import { DoorSheetService } from '../door-sheet.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { UpdateOrgDto } from '../../org/dto/update-org.dto';
import { sheetIdFrom } from '../../org/org.service';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * Issuing door codes and mirroring them to a co-op's sheet (DOR-01).
 *
 * The ordering rules are the ones worth holding: a code is written to the
 * sheet before the member is told it works, and the member is marked as
 * synced only after the sheet has actually taken them. Both failures are
 * quiet and both end the same way — somebody at a locked door with a code
 * that opens nothing.
 */
describe('DoorService', () => {
  let service: DoorService;
  let prisma: jest.Mocked<PrismaService>;
  let sheet: { syncRows: jest.Mock; isConfigured: boolean };
  let email: { sendDoorCode: jest.Mock };

  const ORG = 'org-1';

  const org = (over: Record<string, unknown> = {}) => ({
    id: ORG,
    name: 'MaybeItsFate',
    slug: 'maybeitsfate',
    doorAccessEnabled: true,
    doorSheetId: 'sheet-1',
    doorCodeEmailsEnabled: false,
    ...over,
  });

  beforeEach(async () => {
    sheet = { syncRows: jest.fn().mockResolvedValue({ updated: 0, added: 0 }), isConfigured: true };
    email = { sendDoorCode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoorService,
        { provide: DoorSheetService, useValue: sheet },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        {
          provide: PrismaService,
          useValue: {
            organization: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
            userOrg: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          },
        },
      ],
    }).compile();

    service = module.get<DoorService>(DoorService);
    prisma = module.get(PrismaService);
  });

  describe('issuing codes', () => {
    it('gives a code to every member who has none', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as never);

      expect(await service.issuePins(ORG)).toBe(2);
      expect(prisma.userOrg.update).toHaveBeenCalledTimes(2);
      const { data } = (prisma.userOrg.update as jest.Mock).mock.calls[0][0];
      expect(data.doorPin).toMatch(/^[ABCDEFGHJKMNOPQRSTUVWXYZ]{5}$/);
    });

    it('tries again when the letters are already taken in this co-op', async () => {
      // The unique index is what decides, not a check-then-write: two passes
      // running at once would otherwise both find the same code free.
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }] as never);
      const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
      (prisma.userOrg.update as jest.Mock)
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({});

      expect(await service.issuePins(ORG)).toBe(1);
      expect(prisma.userOrg.update).toHaveBeenCalledTimes(2);
    });

    it('gives up rather than looping forever, and says so', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }] as never);
      (prisma.userOrg.update as jest.Mock).mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      expect(await service.issuePins(ORG)).toBe(0);
      expect(prisma.userOrg.update).toHaveBeenCalledTimes(5);
    });

    it('does not swallow a real database failure', async () => {
      prisma.userOrg.findMany.mockResolvedValue([{ id: 'm1' }] as never);
      (prisma.userOrg.update as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(service.issuePins(ORG)).rejects.toThrow('connection lost');
    });
  });

  describe('writing the sheet', () => {
    const member = {
      id: 'm1',
      doorPin: 'ABCDE',
      user: { email: 'ada@example.com', name: 'Ada Lovelace' },
    };

    it('sends email, code and name, which is what the door app reads', async () => {
      prisma.userOrg.findMany.mockResolvedValue([member] as never);

      expect(await service.syncSheet(ORG, 'sheet-1')).toBe(1);
      expect(sheet.syncRows).toHaveBeenCalledWith('sheet-1', [
        { email: 'ada@example.com', pin: 'ABCDE', name: 'Ada Lovelace' },
      ]);
    });

    it('marks members synced only after the sheet has taken them', async () => {
      // Marking first would lose people quietly: the next pass would think
      // they were written, and they would stand at the door with a code the
      // sheet has never heard of.
      prisma.userOrg.findMany.mockResolvedValue([member] as never);
      sheet.syncRows.mockRejectedValue(new Error('Google is down'));

      await expect(service.syncSheet(ORG, 'sheet-1')).rejects.toThrow('Google is down');
      expect(prisma.userOrg.updateMany).not.toHaveBeenCalled();
    });

    it('sends a member with no name as an empty name rather than "null"', async () => {
      prisma.userOrg.findMany.mockResolvedValue([
        { ...member, user: { email: 'ada@example.com', name: null } },
      ] as never);

      await service.syncSheet(ORG, 'sheet-1');
      expect(sheet.syncRows.mock.calls[0][1][0].name).toBe('');
    });

    it('does not call Google at all when nobody is waiting', async () => {
      prisma.userOrg.findMany.mockResolvedValue([] as never);

      expect(await service.syncSheet(ORG, 'sheet-1')).toBe(0);
      expect(sheet.syncRows).not.toHaveBeenCalled();
    });
  });

  describe('telling members', () => {
    it('emails nobody until the co-op turns emails on', async () => {
      // Charley's first run: fill the sheet, email nobody. A few hundred door
      // codes arriving unannounced is not something to set off by deploying.
      prisma.organization.findUnique.mockResolvedValue(org() as never);
      prisma.userOrg.findMany.mockResolvedValue([] as never);

      await service.syncOrg(ORG);

      expect(email.sendDoorCode).not.toHaveBeenCalled();
    });

    it('emails the code and where to find it again', async () => {
      prisma.userOrg.findMany.mockResolvedValue([
        { id: 'm1', doorPin: 'ABCDE', user: { email: 'ada@example.com', name: 'Ada' } },
      ] as never);

      expect(await service.emailPending(org() as never)).toBe(1);
      expect(email.sendDoorCode).toHaveBeenCalledWith(
        'ada@example.com',
        expect.objectContaining({
          pin: 'ABCDE',
          profileUrl: 'https://maybeos.org/member/maybeitsfate/profile',
        }),
      );
    });

    it('only considers members whose row is already in the sheet', async () => {
      // An email saying the door works, sent before the door works, is worse
      // than a late one.
      await service.emailPending(org() as never);

      const { where } = (prisma.userOrg.findMany as jest.Mock).mock.calls[0][0];
      expect(where.doorPinSyncedAt).toEqual({ not: null });
      expect(where.doorPinEmailedAt).toBeNull();
    });
  });

  describe('a co-op that has not set this up', () => {
    it('does nothing, without complaining', async () => {
      prisma.organization.findUnique.mockResolvedValue(
        org({ doorAccessEnabled: false }) as never,
      );

      expect(await service.syncOrg(ORG)).toEqual({ issued: 0, synced: 0, emailed: 0 });
      expect(sheet.syncRows).not.toHaveBeenCalled();
    });

    it('does nothing when no sheet has been named', async () => {
      prisma.organization.findUnique.mockResolvedValue(org({ doorSheetId: null }) as never);

      expect(await service.syncOrg(ORG)).toEqual({ issued: 0, synced: 0, emailed: 0 });
    });
  });

  describe('one co-op failing', () => {
    it('does not stop the next co-op’s door', async () => {
      prisma.organization.findMany.mockResolvedValue([
        org({ id: 'a', slug: 'a' }),
        org({ id: 'b', slug: 'b' }),
      ] as never);
      prisma.organization.findUnique
        .mockResolvedValueOnce(org({ id: 'a', slug: 'a' }) as never)
        .mockResolvedValueOnce(org({ id: 'b', slug: 'b' }) as never);
      prisma.userOrg.findMany
        .mockResolvedValueOnce([] as never) // a: nobody to issue
        .mockResolvedValueOnce([
          { id: 'm1', doorPin: 'ABCDE', user: { email: 'x@y.z', name: 'X' } },
        ] as never)
        .mockResolvedValue([] as never);
      sheet.syncRows.mockRejectedValueOnce(new Error('sheet not shared'));

      await expect(service.runDue()).resolves.toBeDefined();
      // Reached the second co-op after the first threw.
      expect(prisma.organization.findUnique).toHaveBeenCalledTimes(2);
    });

    it('does nothing at all when Google is not configured', async () => {
      sheet.isConfigured = false;

      expect(await service.runDue()).toEqual({ issued: 0, synced: 0, emailed: 0 });
      expect(prisma.organization.findMany).not.toHaveBeenCalled();
    });
  });

  describe('replacing a code', () => {
    it('queues a rewrite of the sheet and a fresh email', async () => {
      // A lost code and a leaked one are the same job: new letters, the sheet
      // rewritten, the old code dead from that moment.
      prisma.userOrg.findFirst.mockResolvedValue({ id: 'm1' } as never);

      const { doorPin } = await service.regenerate(ORG, 'user-1');

      expect(doorPin).toMatch(/^[ABCDEFGHJKMNOPQRSTUVWXYZ]{5}$/);
      const { data } = (prisma.userOrg.update as jest.Mock).mock.calls[0][0];
      expect(data.doorPinSyncedAt).toBeNull();
      expect(data.doorPinEmailedAt).toBeNull();
    });
  });
});

describe('the sheet an organiser pastes in', () => {
  it('takes the id out of a Google address', () => {
    expect(
      sheetIdFrom(
        'https://docs.google.com/spreadsheets/d/1Qg4JZ6VWwP8iIO8_k9pLTn2UbqTOZli-mc98YSi4lzo/edit?gid=0#gid=0',
      ),
    ).toBe('1Qg4JZ6VWwP8iIO8_k9pLTn2UbqTOZli-mc98YSi4lzo');
  });

  it('leaves a bare id alone', () => {
    expect(sheetIdFrom('1Qg4JZ6VWwP8iIO8_k9pLTn2UbqTOZli-mc98YSi4lzo')).toBe(
      '1Qg4JZ6VWwP8iIO8_k9pLTn2UbqTOZli-mc98YSi4lzo',
    );
  });

  it('treats blank as cleared', () => {
    expect(sheetIdFrom('   ')).toBeNull();
    expect(sheetIdFrom(null)).toBeNull();
  });
});

describe('the door settings through the validation whitelist', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const validate = (body: object) =>
    pipe.transform(body, { type: 'body', metatype: UpdateOrgDto });

  it('accepts the three switches the Settings page sends', async () => {
    await expect(
      validate({
        doorAccessEnabled: true,
        doorCodeEmailsEnabled: false,
        doorSheetId: 'https://docs.google.com/spreadsheets/d/abc/edit',
      }),
    ).resolves.toMatchObject({ doorAccessEnabled: true });
  });

  it('accepts null, which is how a co-op forgets its sheet', async () => {
    await expect(validate({ doorSheetId: null })).resolves.toMatchObject({ doorSheetId: null });
  });
});
