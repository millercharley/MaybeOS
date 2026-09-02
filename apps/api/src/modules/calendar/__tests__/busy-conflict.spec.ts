import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The room's calendar is read as well as written (SPC-08).
 *
 * SPC-04 made bookings reach Google. Nothing ever came back the other way, so
 * a co-op that put a rehearsal straight into the room's calendar would still
 * take a member's booking for the same hour — and confirm it.
 */
describe('CalendarService — busyConflict', () => {
  let service: CalendarService;
  let calendarApi: any;

  const ROOM = {
    id: 'room-1',
    name: 'Attic',
    googleTokens: { access_token: 'x' },
    googleCalendarId: 'attic@group.calendar.google.com',
  };

  const at = (h: number) => new Date(`2026-09-10T${String(h).padStart(2, '0')}:00:00Z`);
  const busy = (from: number, to: number) => ({
    data: {
      calendars: {
        'attic@group.calendar.google.com': {
          busy: [{ start: at(from).toISOString(), end: at(to).toISOString() }],
        },
      },
    },
  });

  beforeEach(async () => {
    calendarApi = {
      freebusy: { query: jest.fn().mockResolvedValue(busy(10, 12)) },
      events: { get: jest.fn() },
    };
    jest.spyOn(google, 'calendar').mockReturnValue(calendarApi);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: { room: {}, booking: {} } },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({
                GOOGLE_CLIENT_ID: 'id',
                GOOGLE_CLIENT_SECRET: 'secret',
                GOOGLE_REDIRECT_URI: 'https://maybeos.org/api/calendar/oauth/callback',
              })[k],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CalendarService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports a clash with something already on the calendar', async () => {
    await expect(service.busyConflict(ROOM, at(11), at(13))).resolves.toEqual({ busy: true });
  });

  it('does not treat back-to-back as a clash', async () => {
    // A booking that starts exactly when another ends is fine, and refusing it
    // would cost a co-op every second slot in the day.
    await expect(service.busyConflict(ROOM, at(12), at(14))).resolves.toEqual({ busy: false });
  });

  it('says nothing is busy for a room with no calendar chosen', async () => {
    await expect(
      service.busyConflict({ ...ROOM, googleCalendarId: null }, at(11), at(13)),
    ).resolves.toEqual({ busy: false });

    expect(calendarApi.freebusy.query).not.toHaveBeenCalled();
  });

  it('lets the booking through when Google is unreachable', async () => {
    calendarApi.freebusy.query.mockRejectedValue(new Error('googleapis unreachable'));

    // Failing open is deliberate: a co-op must not be unable to book its own
    // rooms because somebody else's API is down. The local rules still apply.
    await expect(service.busyConflict(ROOM, at(11), at(13))).resolves.toEqual({
      busy: false,
      reason: 'googleapis unreachable',
    });
  });

  describe('a booking being moved', () => {
    beforeEach(() => {
      calendarApi.events.get.mockResolvedValue({
        data: {
          start: { dateTime: at(10).toISOString() },
          end: { dateTime: at(12).toISOString() },
        },
      });
    });

    it('does not collide with its own event', async () => {
      // Shifting a 10–12 rehearsal to 11–13 must not be refused because 11–12
      // is "taken" by the very booking being moved.
      await expect(
        service.busyConflict(ROOM, at(11), at(13), 'event-1'),
      ).resolves.toEqual({ busy: false });
    });

    it('still collides with somebody else in the same window', async () => {
      // Google merges overlapping events into one period, so an 11–13 event
      // next to our own 10–12 arrives as a single 10–13 block. Our window does
      // not cover it, and that is somebody else's booking.
      calendarApi.freebusy.query.mockResolvedValue(busy(10, 13));

      await expect(
        service.busyConflict(ROOM, at(11), at(13), 'event-1'),
      ).resolves.toEqual({ busy: true });
    });

    it('excuses nothing when its event has vanished from Google', async () => {
      calendarApi.events.get.mockRejectedValue(new Error('Not Found'));

      await expect(
        service.busyConflict(ROOM, at(11), at(13), 'event-1'),
      ).resolves.toEqual({ busy: true });
    });
  });
});
