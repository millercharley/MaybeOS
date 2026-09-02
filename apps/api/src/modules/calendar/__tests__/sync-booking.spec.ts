import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarService } from '../calendar.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Bookings reach the room's Google Calendar (SPC-04).
 *
 * Every CRUD method on this service has worked since SpaceOS was built and
 * **nothing ever called one**: `SpaceModule` did not import `CalendarModule`,
 * so no booking in the product's history had ever reached Google. Connecting a
 * room's calendar stored tokens and changed nothing else.
 *
 * The rule these pin down is that the calendar is a *copy* of the booking. The
 * booking is the record, so a calendar that is unreachable, revoked, or simply
 * never connected must never fail one.
 */
describe('CalendarService — syncBooking', () => {
  let service: CalendarService;
  let prisma: any;

  const withRoom = (room: Record<string, unknown>, booking: Record<string, unknown> = {}) => ({
    id: 'booking-1',
    title: 'Rehearsal',
    description: null,
    startTime: new Date('2026-09-01T09:00:00Z'),
    endTime: new Date('2026-09-01T12:00:00Z'),
    googleEventId: null,
    ...booking,
    room: {
      id: 'room-1',
      name: 'Main Hall',
      googleCalendarId: 'attic@group.calendar.google.com',
      ...room,
    },
  });

  beforeEach(async () => {
    prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(withRoom({ googleTokens: { access_token: 'x' } })),
        update: jest.fn().mockResolvedValue({}),
      },
      room: { update: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'x' } },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
  });

  it('scopes the lookup through the org, never by bare booking id', async () => {
    await service.syncBooking('org-1', 'booking-1', 'create');

    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking-1', room: { orgId: 'org-1' } },
      }),
    );
  });

  it('asks for the tokens the client omits by default', async () => {
    // SEC-05 omits Room.googleTokens globally after they shipped to browsers.
    // Calling Google as the room needs them back, explicitly.
    await service.syncBooking('org-1', 'booking-1', 'create');

    const include = prisma.booking.findFirst.mock.calls[0][0].include;
    expect(include.room.omit).toEqual({ googleTokens: false });
  });

  it('does nothing for a room with no calendar connected', async () => {
    // The normal case, and not a fault: most rooms will never be connected.
    prisma.booking.findFirst.mockResolvedValue(withRoom({ googleTokens: null }));

    const result = await service.syncBooking('org-1', 'booking-1', 'create');

    expect(result.synced).toBe(false);
    expect(result.reason).toMatch(/no calendar/i);
  });

  it('creates rather than fails when an update finds nothing on the calendar', async () => {
    // A booking approved after it was made has no event yet. Treating that as
    // an error would leave the room's calendar permanently missing it.
    const create = jest.spyOn(service, 'createCalendarEvent').mockResolvedValue({} as any);
    prisma.booking.findFirst.mockResolvedValue(
      withRoom({ googleTokens: { access_token: 'x' } }, { googleEventId: null }),
    );

    const result = await service.syncBooking('org-1', 'booking-1', 'update');

    expect(create).toHaveBeenCalled();
    expect(result.synced).toBe(true);
  });

  it('does not create a second event for a booking already on the calendar', async () => {
    const create = jest.spyOn(service, 'createCalendarEvent').mockResolvedValue({} as any);
    prisma.booking.findFirst.mockResolvedValue(
      withRoom({ googleTokens: { access_token: 'x' } }, { googleEventId: 'gcal-1' }),
    );

    const result = await service.syncBooking('org-1', 'booking-1', 'create');

    expect(create).not.toHaveBeenCalled();
    expect(result.synced).toBe(false);
  });

  it('swallows a Google failure instead of failing the booking', async () => {
    // The booking is the record; the calendar is a copy of it. A member must
    // not lose a room because Google was down.
    jest
      .spyOn(service, 'createCalendarEvent')
      .mockRejectedValue(new Error('googleapis unreachable'));

    await expect(service.syncBooking('org-1', 'booking-1', 'create')).resolves.toEqual({
      synced: false,
      reason: 'googleapis unreachable',
    });
  });

  it('reports a booking that is not there rather than throwing', async () => {
    prisma.booking.findFirst.mockResolvedValue(null);

    const result = await service.syncBooking('org-1', 'missing', 'delete');

    expect(result.synced).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it('has nothing to remove when a booking never reached the calendar', async () => {
    prisma.booking.findFirst.mockResolvedValue(
      withRoom({ googleTokens: { access_token: 'x' } }, { googleEventId: null }),
    );

    const result = await service.syncBooking('org-1', 'booking-1', 'delete');

    expect(result.synced).toBe(false);
  });
});
