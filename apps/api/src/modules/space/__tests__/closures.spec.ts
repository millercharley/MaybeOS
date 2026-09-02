import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';
import { slotsForDate, type Rule } from '../availability/slots';

/**
 * Closing a room for a day, a run of days, or part of them (SPC-12).
 *
 * The engine has subtracted blackout rules from opening hours since SPC-09 and
 * nothing could create one, so "closed for the holidays" was unsayable. The
 * hard part is not the storing: dates arrive as calendar dates and have to
 * become instants in the co-op's timezone, because "closed on the 25th" means
 * the 25th where the room is.
 */
describe('SpaceService — closures', () => {
  let service: SpaceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      room: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'room-1',
          orgId: 'org-1',
          org: { timezone: 'America/New_York' },
        }),
      },
      availabilityRule: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        { provide: CalendarService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(SpaceService);
  });

  const written = () => prisma.availabilityRule.create.mock.calls[0][0].data;

  it('spans a single day from its midnight to its last minute, locally', async () => {
    await service.addClosure('org-1', 'room-1', { fromDate: '2026-12-25' } as never);

    // Midnight Eastern on the 25th is 05:00 UTC — not midnight UTC, which
    // would have shut the room for the last five hours of Christmas Eve and
    // reopened it five hours before the day was over.
    expect(written().effectiveFrom.toISOString()).toBe('2026-12-25T05:00:00.000Z');
    expect(written().effectiveTo.toISOString()).toBe('2026-12-26T04:59:00.000Z');
  });

  it('closes a whole day by default', async () => {
    await service.addClosure('org-1', 'room-1', { fromDate: '2026-12-25' } as never);

    expect(written()).toMatchObject({ startTime: '00:00', endTime: '23:59', isBlackout: true });
  });

  it('covers every day of a range', async () => {
    await service.addClosure('org-1', 'room-1', {
      fromDate: '2026-12-24',
      toDate: '2027-01-02',
    } as never);

    expect(written().effectiveFrom.toISOString()).toBe('2026-12-24T05:00:00.000Z');
    expect(written().effectiveTo.toISOString()).toBe('2027-01-03T04:59:00.000Z');
  });

  it('keeps the reason', async () => {
    await service.addClosure('org-1', 'room-1', {
      fromDate: '2026-12-25',
      label: '  Winter break  ',
    } as never);

    expect(written().label).toBe('Winter break');
  });

  it('stores no reason rather than an empty one', async () => {
    await service.addClosure('org-1', 'room-1', {
      fromDate: '2026-12-25',
      label: '   ',
    } as never);

    expect(written().label).toBeNull();
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      service.addClosure('org-1', 'room-1', {
        fromDate: '2026-12-25',
        toDate: '2026-12-01',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a part-day closure that ends before it starts', async () => {
    await expect(
      service.addClosure('org-1', 'room-1', {
        fromDate: '2026-12-25',
        startTime: '17:00',
        endTime: '13:00',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('reports dates back in the co-op\'s own days', async () => {
    prisma.availabilityRule.findMany.mockResolvedValue([
      {
        id: 'c1',
        label: 'Winter break',
        startTime: '00:00',
        endTime: '23:59',
        effectiveFrom: new Date('2026-12-25T05:00:00.000Z'),
        effectiveTo: new Date('2026-12-26T04:59:00.000Z'),
      },
    ]);

    // The instants only mean the 25th once the timezone is applied, which is
    // knowledge the server has and the browser does not.
    await expect(service.listClosures('org-1', 'room-1')).resolves.toEqual([
      {
        id: 'c1',
        label: 'Winter break',
        fromDate: '2026-12-25',
        toDate: '2026-12-25',
        startTime: '00:00',
        endTime: '23:59',
        allDay: true,
      },
    ]);
  });

  it('will not delete opening hours through the closure route', async () => {
    // Scoped to blackouts, or this becomes a way to dismantle a room's hours
    // one rule at a time.
    prisma.availabilityRule.findFirst.mockResolvedValue(null);

    await expect(
      service.removeClosure('org-1', 'room-1', 'a-normal-rule'),
    ).rejects.toThrow('Closure not found');

    expect(prisma.availabilityRule.delete).not.toHaveBeenCalled();
  });
});

/**
 * And what a member sees on a closed day.
 */
describe('closures in the slot list', () => {
  const NY = 'America/New_York';

  const openHours: Rule = {
    dayOfWeek: null,
    startTime: '09:00',
    endTime: '17:00',
    isBlackout: false,
    effectiveFrom: null,
    effectiveTo: null,
  };

  const closure = (over: Partial<Rule>): Rule => ({
    dayOfWeek: null,
    startTime: '00:00',
    endTime: '23:59',
    isBlackout: true,
    label: 'Winter break',
    effectiveFrom: new Date('2026-12-24T05:00:00.000Z'),
    effectiveTo: new Date('2027-01-03T04:59:00.000Z'),
    ...over,
  });

  const on = (date: string, rules: Rule[]) =>
    slotsForDate({
      date,
      timeZone: NY,
      durationMinutes: 60,
      alwaysAvailable: false,
      rules,
      booked: [],
      busy: [],
      now: new Date('2026-12-01T00:00:00Z'),
    });

  it('shuts every day inside the range', () => {
    for (const date of ['2026-12-24', '2026-12-31', '2027-01-02']) {
      expect(on(date, [openHours, closure({})]).some((s) => s.available)).toBe(false);
    }
  });

  it('leaves the days either side open', () => {
    expect(on('2026-12-23', [openHours, closure({})]).some((s) => s.available)).toBe(true);
    expect(on('2027-01-03', [openHours, closure({})]).some((s) => s.available)).toBe(true);
  });

  it('tells the member why', () => {
    const slot = on('2026-12-25', [openHours, closure({})]).find((s) => s.minutes === 10 * 60);

    expect(slot).toMatchObject({ reason: 'blackout', note: 'Winter break' });
  });

  it('shuts only the named hours for a part-day closure', () => {
    const lunch = closure({ startTime: '12:00', endTime: '13:00', label: 'Deep clean' });
    const slots = on('2026-12-25', [openHours, lunch]);

    expect(slots.find((s) => s.minutes === 10 * 60)?.available).toBe(true);
    expect(slots.find((s) => s.minutes === 12 * 60)).toMatchObject({
      reason: 'blackout',
      note: 'Deep clean',
    });
  });

  it('says nothing extra when a closure has no reason', () => {
    const slot = on('2026-12-25', [openHours, closure({ label: null })]).find(
      (s) => s.minutes === 10 * 60,
    );

    expect(slot?.reason).toBe('blackout');
    expect(slot?.note).toBeUndefined();
  });
});
