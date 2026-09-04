import { Test, TestingModule } from '@nestjs/testing';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { EmailService } from '../../email/email.service';
import { ConnectService } from '../../stripe/connect.service';
import { EventsService } from '../../events/events.service';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';

/**
 * The whole building's day, for any member (SPC-18).
 *
 * Two things here are easy to get wrong and invisible when you do: which
 * instants count as "the day", and what a member who ticked "just my guests"
 * has agreed to publish.
 */
describe('SpaceService — the day view', () => {
  let service: SpaceService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const member = { userId: 'u1', orgId: ORG, privileged: false };

  const booking = (over: Record<string, unknown> = {}) => ({
    id: 'b1',
    title: 'Book club',
    description: 'We are reading Jane Jacobs.',
    visibility: 'MEMBERS_ONLY',
    status: 'APPROVED',
    startTime: new Date('2026-09-05T18:00:00Z'),
    endTime: new Date('2026-09-05T20:00:00Z'),
    expectedAttendance: 6,
    categories: [],
    room: { id: 'r1', name: 'Main Hall' },
    user: { id: 'u9', name: 'Alex', avatarUrl: null, avatarPath: null },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        {
          provide: PrismaService,
          useValue: {
            organization: {
              findUnique: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }),
            },
            booking: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        { provide: CalendarService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    prisma = module.get(PrismaService);
  });

  const whereOf = () =>
    (prisma.booking.findMany.mock.calls[0][0] as { where: Record<string, any> }).where;

  describe('which day it is', () => {
    it('uses the co-op’s timezone, not the server’s', async () => {
      // 2026-09-05 in New York begins at 04:00Z, not at midnight Z. A member
      // reading this from another city is asking what is on at the building.
      await service.dayBookings(ORG, '2026-09-05', member as never);

      const where = whereOf();
      expect(where.startTime.lt.toISOString()).toBe('2026-09-06T04:00:00.000Z');
      expect(where.endTime.gt.toISOString()).toBe('2026-09-05T04:00:00.000Z');
    });

    it('includes a booking that only overlaps the day', async () => {
      // A 10pm–1am booking belongs on both days it touches. Asking for
      // bookings *contained* by the day would drop it from both.
      const where = await service
        .dayBookings(ORG, '2026-09-05', member as never)
        .then(() => whereOf());

      expect(where.startTime).toHaveProperty('lt');
      expect(where.endTime).toHaveProperty('gt');
    });
  });

  describe('what counts as on', () => {
    it('leaves out cancelled, rejected and held slots', async () => {
      await service.dayBookings(ORG, '2026-09-05', member as never);

      // PENDING_PAYMENT is a hold during checkout, not a plan — it disappears
      // on its own if the payment is abandoned.
      expect(whereOf().status).toEqual({ in: ['APPROVED', 'PENDING'] });
    });

    it('stays inside this co-op', async () => {
      await service.dayBookings(ORG, '2026-09-05', member as never);
      expect(whereOf().room).toEqual({ orgId: ORG });
    });
  });

  describe('what a member is shown', () => {
    it('shows the description of a booking open to members', async () => {
      prisma.booking.findMany.mockResolvedValue([booking()] as never);

      const { bookings } = await service.dayBookings(ORG, '2026-09-05', member as never);

      expect(bookings[0].description).toBe('We are reading Jane Jacobs.');
    });

    it('shows the description of a private booking too', async () => {
      // An earlier version withheld this. Charley's call, 2026-09-05: a shared
      // building's schedule is something its members can read, and
      // `visibility` answers who is *invited* rather than who may look.
      //
      // The consequence worth remembering is that PRIVATE is the default, so
      // this is not a setting anybody opts into — whatever a member types into
      // a booking description is readable by the whole co-op.
      prisma.booking.findMany.mockResolvedValue([
        booking({ visibility: 'PRIVATE' }),
      ] as never);

      const { bookings } = await service.dayBookings(ORG, '2026-09-05', member as never);

      expect(bookings[0].description).toBe('We are reading Jane Jacobs.');
      expect(bookings[0].title).toBe('Book club');
      expect(bookings[0].user.name).toBe('Alex');
      expect(bookings[0].room.name).toBe('Main Hall');
    });

    it('leaves a booking with no description alone', async () => {
      prisma.booking.findMany.mockResolvedValue([
        booking({ visibility: 'PRIVATE', description: null }),
      ] as never);

      const { bookings } = await service.dayBookings(ORG, '2026-09-05', member as never);
      expect(bookings[0].description).toBeNull();
    });

    it('never hands a member somebody else’s email address', async () => {
      await service.dayBookings(ORG, '2026-09-05', member as never);

      const select = (prisma.booking.findMany.mock.calls[0][0] as { select: any }).select;
      expect(select.user.select.email).toBe(false);
    });
  });
});
