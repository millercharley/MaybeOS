import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * A room points at a calendar somebody chose (SPC-07).
 *
 * `googleCalendarId` sat in the schema since SpaceOS was built and nothing
 * ever set it, so five call sites read `room.googleCalendarId || 'primary'`
 * and every one of them resolved to 'primary' — the personal calendar of
 * whichever organiser clicked Connect. Their dentist appointment would have
 * blocked the Attic and the Attic's bookings would have appeared in their own
 * diary. The default is now no calendar, which is a state the admin is shown.
 */
describe('CalendarService — choosing a calendar', () => {
  let service: CalendarService;
  let prisma: any;
  let calendarApi: any;

  const CONNECTED = {
    id: 'room-1',
    name: 'Attic',
    googleTokens: { access_token: 'x', refresh_token: 'y' },
    googleCalendarId: null,
    googleAccountEmail: 'coop@example.org',
  };

  beforeEach(async () => {
    calendarApi = {
      calendarList: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              { id: 'coop@example.org', summary: 'coop@example.org', primary: true },
              { id: 'attic@group.calendar.google.com', summary: 'Attic' },
            ],
          },
        }),
      },
      calendars: { get: jest.fn() },
      events: { get: jest.fn() },
      freebusy: { query: jest.fn() },
    };
    jest.spyOn(google, 'calendar').mockReturnValue(calendarApi);

    prisma = {
      room: {
        findFirst: jest.fn().mockResolvedValue(CONNECTED),
        update: jest.fn().mockImplementation(({ data }) => ({ ...CONNECTED, ...data })),
      },
      booking: { findFirst: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
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

  it('offers only calendars the account can write to', async () => {
    await service.listCalendars(CONNECTED as any);

    // A calendar the account can only read would be accepted here and then
    // fail on the first booking, hours later, in a log nobody reads.
    expect(calendarApi.calendarList.list).toHaveBeenCalledWith({
      minAccessRole: 'writer',
    });
  });

  it('stores the chosen calendar with the name to show for it', async () => {
    await service.selectCalendar('org-1', 'room-1', 'attic@group.calendar.google.com');

    expect(prisma.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          googleCalendarId: 'attic@group.calendar.google.com',
          googleCalendarName: 'Attic',
        },
      }),
    );
  });

  it('refuses a calendar the account cannot write to', async () => {
    await expect(
      service.selectCalendar('org-1', 'room-1', 'someone-elses@group.calendar.google.com'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('refuses to choose a calendar for a room that is not connected', async () => {
    prisma.room.findFirst.mockResolvedValue({ ...CONNECTED, googleTokens: null });

    await expect(
      service.selectCalendar('org-1', 'room-1', 'attic@group.calendar.google.com'),
    ).rejects.toThrow('Connect this room to Google');
  });

  it('will not write a booking to a room with no calendar chosen', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      googleEventId: null,
      room: { ...CONNECTED, googleCalendarId: null },
    });

    // The old fallback to 'primary' would have put this in somebody's diary.
    await expect(service.syncBooking('org-1', 'booking-1', 'create')).resolves.toEqual({
      synced: false,
      reason: 'room has no calendar chosen yet',
    });
  });

  it('clears the account and the calendar on disconnect', async () => {
    prisma.room.findFirst.mockResolvedValue({
      ...CONNECTED,
      googleCalendarId: 'attic@group.calendar.google.com',
    });

    await service.disconnect('org-1', 'room-1');

    expect(prisma.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          googleTokens: null,
          googleCalendarId: null,
          googleCalendarName: null,
          googleAccountEmail: null,
          googleConnectedAt: null,
        },
      }),
    );
  });
});
