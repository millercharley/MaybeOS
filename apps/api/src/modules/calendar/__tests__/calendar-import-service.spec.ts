import { BadRequestException } from '@nestjs/common';
import { CalendarImportService } from '../calendar-import.service';

/**
 * Which calendar becomes what (CAL-02).
 *
 * The failure this guards against is the one that would be seen by the whole
 * co-op at once: a room's calendar imported as events, so members open
 * MaybeOS on their first day and are invited to attend "DO NOT BOOK — floor
 * sealing" and somebody's private rehearsal. A room being held is not a
 * thing to attend, and nothing in a calendar entry says which it is except
 * the calendar it is on.
 */

const ORG = {
  id: 'org-1',
  timezone: 'America/New_York',
  eventsCalendarId: 'main-events',
};

const entry = (id: string, summary: string) => ({
  id,
  summary,
  start: { dateTime: '2026-10-15T23:00:00Z' },
  end: { dateTime: '2026-10-16T01:00:00Z' },
  organizer: { email: 'ada@example.com' },
});

function build(overrides: Record<string, unknown> = {}) {
  const listed: string[] = [];

  const client = {
    events: {
      list: jest.fn(async ({ calendarId }: { calendarId: string }) => {
        listed.push(calendarId);
        return {
          data: {
            items:
              calendarId === 'main-events'
                ? [entry('e1', 'Board Game Night'), entry('e2', 'Repair Café')]
                : [entry(`${calendarId}-hold`, 'DO NOT BOOK — floor sealing')],
          },
        };
      }),
    },
  };

  const prisma = {
    organization: { findUnique: jest.fn().mockResolvedValue(ORG), update: jest.fn() },
    room: {
      findFirst: jest.fn().mockResolvedValue({ id: 'room-1', googleTokens: { sealed: true } }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'room-1', name: 'Attic', googleCalendarId: 'attic-cal' },
        { id: 'room-2', name: 'Salon', googleCalendarId: 'salon-cal' },
      ]),
    },
    userOrg: { findFirst: jest.fn().mockResolvedValue({ userId: 'user-1' }) },
    event: { upsert: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    booking: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };

  const calendar = {
    clientFor: jest.fn().mockResolvedValue(client),
    listCalendars: jest.fn().mockResolvedValue([
      { id: 'main-events', name: 'MaybeItsFate Main Events', primary: false },
      { id: 'attic-cal', name: 'Attic', primary: false },
    ]),
  };

  const service = new CalendarImportService(prisma as never, calendar as never);
  return { service, prisma, calendar, listed };
}

describe('which calendar becomes what', () => {
  it('makes events only from the chosen events calendar', async () => {
    const { service, prisma } = build();

    await service.run('org-1', { dryRun: false });

    expect(prisma.event.upsert).toHaveBeenCalledTimes(2);
    const titles = prisma.event.upsert.mock.calls.map((c: any) => c[0].create.title);
    expect(titles).toEqual(['Board Game Night', 'Repair Café']);
  });

  it('makes bookings, never events, from a room’s own calendar', async () => {
    const { service, prisma } = build();

    await service.run('org-1', { dryRun: false });

    // The whole point: "DO NOT BOOK — floor sealing" holds a room and is not
    // something to invite a community to.
    expect(prisma.booking.create).toHaveBeenCalledTimes(2);
    const bookingTitles = prisma.booking.create.mock.calls.map((c: any) => c[0].data.title);
    expect(bookingTitles.every((t: string) => t.includes('DO NOT BOOK'))).toBe(true);

    const eventTitles = prisma.event.upsert.mock.calls.map((c: any) => c[0].create.title);
    expect(eventTitles).not.toContain('DO NOT BOOK — floor sealing');
  });

  it('imports nothing as an event when no events calendar is chosen', async () => {
    const { service, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue({ ...ORG, eventsCalendarId: null });

    const summary = await service.run('org-1', { dryRun: false });

    expect(prisma.event.upsert).not.toHaveBeenCalled();
    expect(summary.events).toBe(0);
    expect(summary.bookings).toBeGreaterThan(0);
  });

  it('does not read the events calendar twice when a room points at it', async () => {
    const { service, prisma, listed } = build();
    prisma.room.findMany.mockResolvedValue([
      { id: 'room-1', name: 'Attic', googleCalendarId: 'main-events' },
    ]);

    const summary = await service.run('org-1', { dryRun: false });

    // Otherwise every event also becomes a hold on that room, and the room
    // reads as booked solid for a year.
    expect(listed.filter((c) => c === 'main-events')).toHaveLength(1);
    expect(prisma.booking.create).not.toHaveBeenCalled();

    // And it says so. An admin counting eight rooms and finding seven has no
    // way to know which one went or why, which reads as a bug in the import.
    const shared = summary.calendars.find((c) => c.kind === 'shared');
    expect(shared?.name).toBe('Attic');
    expect(shared?.note).toMatch(/events calendar/i);
  });

  it('counts what it dropped, rather than reporting a zero it never counted', async () => {
    const { service, calendar } = build();
    const client = await calendar.clientFor();
    client.events.list.mockResolvedValue({
      data: {
        items: [
          entry('e1', 'Board Game Night'),
          { id: 'e2', summary: 'Called off', status: 'cancelled', start: { dateTime: '2026-10-15T23:00:00Z' }, end: { dateTime: '2026-10-16T00:00:00Z' } },
          { id: 'e3', summary: 'Malformed' },
        ],
      },
    });

    const summary = await service.run('org-1', { dryRun: true });

    // "Nothing was skipped" and "I never counted" look identical in a
    // summary, and only one of them is true.
    expect(summary.skipped).toBeGreaterThan(0);
  });
});

describe('what members see', () => {
  it('publishes imported events to members and not to the public', async () => {
    const { service, prisma } = build();

    await service.run('org-1', { dryRun: false });
    const created = prisma.event.upsert.mock.calls[0][0].create;

    // A bulk import must not put anything on the open internet; a public
    // event is the one thing that can be shared and indexed.
    expect(created.visibility).toBe('MEMBERS_ONLY');
    expect(created.isPublished).toBe(true);
  });

  it('attributes an event to the member who organised it, where it knows them', async () => {
    const { service, prisma } = build();

    await service.run('org-1', { dryRun: false });

    expect(prisma.event.upsert.mock.calls[0][0].create.hostId).toBe('user-1');
  });

  it('leaves the host empty rather than guessing when nobody matches', async () => {
    const { service, prisma } = build();
    prisma.userOrg.findFirst.mockResolvedValue(null);

    const summary = await service.run('org-1', { dryRun: false });

    expect(prisma.event.upsert.mock.calls[0][0].create.hostId).toBeNull();
    // And with no admin to own them, the room entries are left alone rather
    // than attributed to nobody.
    expect(summary.bookings).toBe(0);
  });
});

describe('looking before writing', () => {
  it('writes nothing on a dry run, and still says what it found', async () => {
    const { service, prisma } = build();

    const summary = await service.run('org-1', { dryRun: true });

    expect(prisma.event.upsert).not.toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(summary.dryRun).toBe(true);
    expect(summary.events).toBe(2);
    expect(summary.bookings).toBe(2);
    expect(summary.calendars.map((c) => c.kind)).toEqual(['events', 'room', 'room']);
  });

  it('defaults to a dry run when nobody says otherwise', async () => {
    const { service, prisma } = build();

    await service.run('org-1');

    expect(prisma.event.upsert).not.toHaveBeenCalled();
  });
});

describe('choosing the events calendar', () => {
  it('refuses a room’s own calendar, and says whose it is', async () => {
    const { service } = build();

    await expect(service.selectEventsCalendar('org-1', 'attic-cal')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses one this community cannot read', async () => {
    const { service } = build();

    await expect(service.selectEventsCalendar('org-1', 'somebody-elses')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts the one holding the events', async () => {
    const { service, prisma } = build();

    await expect(service.selectEventsCalendar('org-1', 'main-events')).resolves.toEqual({
      eventsCalendarId: 'main-events',
    });
    expect(prisma.organization.update).toHaveBeenCalled();
  });
});

describe('a calendar that cannot be read', () => {
  it('keeps going when one room fails, and still imports the others', async () => {
    const { service, calendar, prisma } = build();
    const client = await calendar.clientFor();
    client.events.list
      // The events calendar reads fine; the first room does not.
      .mockResolvedValueOnce({ data: { items: [entry('e1', 'Board Game Night')] } })
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue({ data: { items: [entry('ok', 'Yoga')] } });

    const summary = await service.run('org-1', { dryRun: false });

    // One room's calendar failing must not cost the co-op the others, or a
    // migration becomes an all-or-nothing against somebody else's API.
    expect(prisma.event.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    expect(summary.calendars).toHaveLength(3);
  });

  it('fails loudly when the events calendar itself cannot be read', async () => {
    const { service, calendar } = build();
    const client = await calendar.clientFor();
    client.events.list.mockRejectedValue(new Error('rate limited'));

    // Deliberately not swallowed, unlike a room's. The events calendar is
    // what the admin pressed the button for; importing the rooms and
    // reporting success would read as "done" for an import that silently
    // produced no events at all.
    await expect(service.run('org-1', { dryRun: false })).rejects.toThrow('rate limited');
  });
});
