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
 * Closing the whole building (SPC-13).
 *
 * Per-room closures are right for a repair to one room and tedious for a
 * public holiday: a co-op with a dozen rooms had to add the same fortnight
 * twelve times, and remove it twelve times.
 */
describe('building closures in the slot engine', () => {
  const NY = 'America/New_York';

  const openHours: Rule = {
    dayOfWeek: null,
    startTime: '09:00',
    endTime: '17:00',
    isBlackout: false,
    effectiveFrom: null,
    effectiveTo: null,
  };

  const buildingShut: Rule = {
    dayOfWeek: null,
    startTime: '00:00',
    endTime: '23:59',
    isBlackout: true,
    label: 'Public holiday',
    effectiveFrom: new Date('2026-12-25T05:00:00.000Z'),
    effectiveTo: new Date('2026-12-26T04:59:00.000Z'),
  };

  const on = (date: string, rules: Rule[], closures: Rule[] = []) =>
    slotsForDate({
      date,
      timeZone: NY,
      durationMinutes: 60,
      alwaysAvailable: false,
      rules,
      booked: [],
      busy: [],
      closures,
      now: new Date('2026-12-01T00:00:00Z'),
    });

  it('shuts a room that has its own opening hours', () => {
    const slots = on('2026-12-25', [openHours], [buildingShut]);

    expect(slots.some((s) => s.available)).toBe(false);
    expect(slots.find((s) => s.minutes === 10 * 60)).toMatchObject({
      reason: 'blackout',
      note: 'Public holiday',
    });
  });

  it('leaves other days alone', () => {
    expect(on('2026-12-26', [openHours], [buildingShut]).some((s) => s.available)).toBe(true);
  });

  it('does not make an unfinished room bookable', () => {
    // The trap in the obvious implementation. Merging a building closure into
    // the room's own rules array would give a room with no hours exactly one
    // rule — so it would stop counting as unfinished, fall through to
    // unrestricted, and become bookable at every hour of the day *because*
    // the building was shut.
    expect(on('2026-12-25', [], [buildingShut])).toEqual([]);
    expect(on('2026-12-26', [], [buildingShut])).toEqual([]);
  });

  it('shuts a room that is marked always available', () => {
    // "Always available" describes the room's hours, not the building's
    // calendar. It does not mean open on Christmas Day.
    const slots = slotsForDate({
      date: '2026-12-25',
      timeZone: NY,
      durationMinutes: 60,
      alwaysAvailable: true,
      rules: [],
      booked: [],
      busy: [],
      closures: [buildingShut],
      now: new Date('2026-12-01T00:00:00Z'),
    });

    expect(slots.some((s) => s.available)).toBe(false);
  });

  it('closes only the named hours for a part-day closure', () => {
    const afternoon: Rule = { ...buildingShut, startTime: '13:00', endTime: '17:00' };
    const slots = on('2026-12-25', [openHours], [afternoon]);

    expect(slots.find((s) => s.minutes === 10 * 60)?.available).toBe(true);
    expect(slots.find((s) => s.minutes === 14 * 60)?.available).toBe(false);
  });

  it("applies alongside a room's own closure", () => {
    const roomShut: Rule = {
      ...buildingShut,
      label: 'Floor repair',
      effectiveFrom: new Date('2026-12-26T05:00:00.000Z'),
      effectiveTo: new Date('2026-12-27T04:59:00.000Z'),
    };

    expect(on('2026-12-25', [openHours, roomShut], [buildingShut]).some((s) => s.available)).toBe(
      false,
    );
    expect(on('2026-12-26', [openHours, roomShut], [buildingShut]).some((s) => s.available)).toBe(
      false,
    );
    expect(on('2026-12-27', [openHours, roomShut], [buildingShut]).some((s) => s.available)).toBe(
      true,
    );
  });
});

describe('SpaceService — booking during a building closure', () => {
  let service: SpaceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }) },
      orgClosure: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'oc1', ...data })),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      room: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'room-1',
          orgId: 'org-1',
          isActive: true,
          requiresApproval: false,
          chargeForBooking: false,
          hourlyRate: null,
          alwaysAvailable: true,
          availabilityRules: [],
          maxBookingMinutes: null,
          org: { timezone: 'America/New_York' },
        }),
      },
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'b1', status: 'APPROVED' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendBookingEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        {
          provide: CalendarService,
          useValue: {
            syncBooking: jest.fn().mockResolvedValue({ synced: false }),
            busyConflictForRoom: jest.fn().mockResolvedValue({ busy: false }),
          },
        },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(SpaceService);
  });

  // 10am–11am Eastern on Christmas Day.
  const christmasMorning = {
    title: 'Rehearsal',
    startTime: '2026-12-25T15:00:00.000Z',
    endTime: '2026-12-25T16:00:00.000Z',
  };

  const allDay = {
    id: 'oc1',
    label: 'Public holiday',
    startTime: '00:00',
    endTime: '23:59',
    effectiveFrom: new Date('2026-12-25T05:00:00.000Z'),
    effectiveTo: new Date('2026-12-26T04:59:00.000Z'),
  };

  it('refuses a booking made straight at the API', async () => {
    prisma.orgClosure.findMany.mockResolvedValue([allDay]);

    // The slot list is what a member sees; this is the request that skipped it.
    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', christmasMorning as never),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('says why the building is shut', async () => {
    prisma.orgClosure.findMany.mockResolvedValue([allDay]);

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', christmasMorning as never),
    ).rejects.toThrow('The building is closed then: Public holiday.');
  });

  it('allows a morning booking when only the afternoon is closed', async () => {
    prisma.orgClosure.findMany.mockResolvedValue([
      { ...allDay, startTime: '13:00', endTime: '17:00' },
    ]);

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', christmasMorning as never),
    ).resolves.toBeDefined();
  });

  it('leaves ordinary days alone', async () => {
    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', christmasMorning as never),
    ).resolves.toBeDefined();
  });

  it('scopes removal through the org, not by bare id', async () => {
    // SEC-04: an id on its own proves nothing about whose building this is.
    prisma.orgClosure.findFirst.mockResolvedValue(null);

    await expect(service.removeOrgClosure('org-1', 'someone-elses')).rejects.toThrow(
      'Closure not found',
    );
    expect(prisma.orgClosure.delete).not.toHaveBeenCalled();
  });
});
