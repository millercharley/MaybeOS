import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Availability rules (SPC-05).
 *
 * This logic went to production unexercised — D-019 flagged that its
 * weekday and HH:mm handling had never run. Executing it on 2026-08-12 found
 * that a room whose only rule was "Mondays 09:00-17:00" accepted a Tuesday
 * booking: the coverage check was skipped whenever no rule applied to the
 * booking's own weekday, so publishing hours for one day left the room open
 * on all six others.
 *
 * `validateAvailability` is private, so these drive it through
 * `checkConflicts`' public sibling by way of createBooking — the same route a
 * request takes.
 */
describe('SpaceService — availability rules', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const ROOM = 'room-1';
  // 2027-03-01 is a Monday; 2027-03-02 a Tuesday.
  const MON = (h: number) => new Date(Date.UTC(2027, 2, 1, h, 0, 0)).toISOString();
  const TUE = (h: number) => new Date(Date.UTC(2027, 2, 2, h, 0, 0)).toISOString();

  const mondayNineToFive = {
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isBlackout: false,
    effectiveFrom: null,
    effectiveTo: null,
  };

  const roomWith = (rules: unknown[], alwaysAvailable = false) => ({
    id: ROOM,
    orgId: ORG,
    requiresApproval: false,
    isActive: true,
    alwaysAvailable,
    availabilityRules: rules,
    // Rules are wall-clock times in the co-op's own zone. These cases were
    // written when they were compared against UTC, so the fixture says UTC to
    // keep asserting the same times.
    org: { timezone: 'UTC' },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        {
          provide: PrismaService,
          useValue: {
            orgClosure: { findMany: jest.fn().mockResolvedValue([]) },
            room: { findFirst: jest.fn() },
            booking: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
        { provide: EmailService, useValue: { send: jest.fn(), sendBookingEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3020') } },
        // SpaceService now keeps a booking's published event in step with it
        // (EVT-05); these tests do not exercise that path.
        { provide: EventsService, useValue: { syncWithBooking: jest.fn() } },
        {
          provide: ConnectService,
          useValue: {
            createBookingCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.test' }),
            refundBooking: jest.fn().mockResolvedValue({ refunded: false }),
          },
        },
        {
          provide: StorageService,
          useValue: { signedAttachmentUrls: jest.fn().mockResolvedValue(new Map()) },
        },
        {
          provide: CalendarService,
          useValue: {
            syncBooking: jest.fn().mockResolvedValue({ synced: false }),
            busyConflictForRoom: jest.fn().mockResolvedValue({ busy: false }),
          },
        },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    prisma = module.get(PrismaService);
  });

  const book = (from: string, to: string) =>
    service.createBooking(ORG, ROOM, 'user-1', {
      title: 'test',
      startTime: from,
      endTime: to,
    } as never);

  describe('a room that publishes hours on one day only', () => {
    beforeEach(() => {
      prisma.room.findFirst.mockResolvedValue(roomWith([mondayNineToFive]) as never);
    });

    it('accepts a booking inside the published window', async () => {
      await expect(book(MON(10), MON(11))).resolves.toBeDefined();
    });

    it('refuses one before opening', async () => {
      await expect(book(MON(7), MON(8))).rejects.toThrow(BadRequestException);
    });

    it('refuses one that runs past closing', async () => {
      await expect(book(MON(16), MON(18))).rejects.toThrow(BadRequestException);
    });

    it('refuses a day the room never published hours for', async () => {
      // The regression: this was approved, because no rule applied to Tuesday
      // and an empty rule set was read as "no restriction".
      await expect(book(TUE(10), TUE(11))).rejects.toThrow(
        /outside the room's available hours/,
      );
    });
  });

  it('refuses a room whose hours nobody has set yet', async () => {
    // This used to succeed. "Open all hours" and "nobody has got to the
    // opening hours" were the same state, so adding a room and stopping there
    // published it at 3am on a Tuesday without anyone choosing that.
    prisma.room.findFirst.mockResolvedValue(roomWith([]) as never);

    await expect(book(TUE(3), TUE(4))).rejects.toThrow(/no bookable hours yet/);
  });

  it('opens a room at any hour once somebody says so', async () => {
    // The same empty rule set, with the difference now stated rather than
    // guessed at.
    prisma.room.findFirst.mockResolvedValue(roomWith([], true) as never);

    await expect(book(TUE(3), TUE(4))).resolves.toBeDefined();
  });

  it('lets always-available beat the rules rather than fight them', async () => {
    // A room marked open all hours that also carries a stale Tuesday rule is
    // open; the flag is the answer, not one vote among several.
    prisma.room.findFirst.mockResolvedValue(
      roomWith(
        [{ dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isBlackout: false, effectiveFrom: null, effectiveTo: null }],
        true,
      ) as never,
    );

    await expect(book(TUE(3), TUE(4))).resolves.toBeDefined();
  });

  it('treats a room with only blackout rules as open except those times', async () => {
    // "Open except Monday lunch" must not become "closed all week".
    prisma.room.findFirst.mockResolvedValue(
      roomWith([
        { dayOfWeek: 1, startTime: '12:00', endTime: '13:00', isBlackout: true, effectiveFrom: null, effectiveTo: null },
      ]) as never,
    );

    await expect(book(TUE(10), TUE(11))).resolves.toBeDefined();
    await expect(book(MON(12), MON(13))).rejects.toThrow(/blackout/);
  });

  it('applies a rule with no weekday to every day', async () => {
    prisma.room.findFirst.mockResolvedValue(
      roomWith([{ ...mondayNineToFive, dayOfWeek: null }]) as never,
    );

    await expect(book(TUE(10), TUE(11))).resolves.toBeDefined();
    await expect(book(TUE(7), TUE(8))).rejects.toThrow(BadRequestException);
  });
});
