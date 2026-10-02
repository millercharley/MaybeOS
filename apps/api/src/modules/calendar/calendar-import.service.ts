import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import { PrismaService } from '../../config/prisma.service';
import { CalendarService } from './calendar.service';
import { ImportedEntry, importWindow, toEntry } from './calendar-import';

/** A year back is the default; two years ahead is the ceiling (see `importWindow`). */
const MONTHS_BACK = 12;

/** Entries read from one calendar in one call. Google pages beyond this. */
const PAGE = 250;

export interface ImportSummary {
  /**
   * What each calendar produced, named so an admin can see where it came
   * from — and carrying its Google id, so a screen can show the calendar's
   * own title and tell two rooms of the same name apart.
   */
  calendars: {
    id: string;
    name: string;
    kind: 'events' | 'room' | 'shared';
    found: number;
    written: number;
    /** Why this one produced nothing, where that needs saying. */
    note?: string;
  }[];
  events: number;
  bookings: number;
  skipped: number;
  dryRun: boolean;
}

/**
 * Bringing a co-op's Google calendars in (CAL-02).
 *
 * **Two kinds of calendar, and the difference is the whole feature.** A room
 * calendar is reservations: holds, maintenance, somebody's rehearsal. Those
 * become bookings, so the rooms page is honest about what is free, and
 * members are never invited to attend "DO NOT BOOK — floor sealing". One
 * named calendar — MaybeItsFate's is "MaybeItsFate Main Events" — holds the
 * things the community is meant to see, and only that one produces events.
 *
 * **Re-running is the normal case, not the exception.** A migration is never
 * one clean pass: somebody edits a title, a date moves, the first run hits a
 * rate limit. Every row carries the Google id it came from, so a second run
 * updates what it wrote before and adds only what is new.
 *
 * **It does not email anybody.** Creating an event normally announces it in
 * the Commons (EVT-23); this writes the rows directly for that reason. An
 * import is a co-op moving its calendar across, not three hundred
 * announcements — the same rule the member importer follows.
 */
@Injectable()
export class CalendarImportService {
  private readonly logger = new Logger(CalendarImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
  ) {}

  /**
   * The calendars this co-op's connected account can see, so an admin can
   * pick the one that holds its events by name rather than by id.
   */
  async available(orgId: string) {
    const room = await this.connectedRoom(orgId);
    const calendars = await this.calendar.listCalendars(room as never);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { eventsCalendarId: true },
    });

    const roomCalendars = await this.prisma.room.findMany({
      where: { orgId, googleCalendarId: { not: null } },
      select: { name: true, googleCalendarId: true },
    });

    const usedByRoom = new Map(roomCalendars.map((r) => [r.googleCalendarId as string, r.name]));

    return calendars.map((c) => ({
      ...c,
      /** Named so an admin does not pick a room's calendar as the events one. */
      room: usedByRoom.get(c.id) ?? null,
      selected: c.id === org?.eventsCalendarId,
    }));
  }

  async selectEventsCalendar(orgId: string, calendarId: string | null) {
    if (calendarId) {
      const calendars = await this.available(orgId);
      const chosen = calendars.find((c) => c.id === calendarId);

      if (!chosen) {
        throw new BadRequestException('That calendar is not one this community can read.');
      }
      if (chosen.room) {
        throw new BadRequestException(
          `That is ${chosen.room}'s own calendar. Pick the one holding the events members should see — a room's calendar is reservations.`,
        );
      }
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { eventsCalendarId: calendarId },
    });

    return { eventsCalendarId: calendarId };
  }

  /** A room with live tokens — any of them, since one account connected them all. */
  private async connectedRoom(orgId: string) {
    const room = await this.prisma.room.findFirst({
      where: { orgId, googleTokens: { not: Prisma.JsonNull } },
      // An explicit select, not `omit: { googleTokens: false }`: Prisma
      // refuses both at once ("Please either choose `select` or `omit`"), and
      // a select of its own already overrides the client-level omission.
      select: { id: true, googleTokens: true },
    });

    if (!room) {
      throw new NotFoundException(
        'No room here has a Google Calendar connected, so there is nothing to read.',
      );
    }

    return room;
  }

  /**
   * Import, or say what an import would do.
   *
   * `dryRun` is the default a caller should reach for first: this writes to
   * the events members will see, and looking at the list before writing is
   * the habit the Stripe adoption scan established.
   */
  async run(
    orgId: string,
    options: { dryRun?: boolean; monthsBack?: number } = {},
  ): Promise<ImportSummary> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, timezone: true, eventsCalendarId: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    const dryRun = options.dryRun ?? true;
    const { from, to } = importWindow(new Date(), options.monthsBack ?? MONTHS_BACK);
    const summary: ImportSummary = {
      calendars: [],
      events: 0,
      bookings: 0,
      skipped: 0,
      dryRun,
    };

    const source = await this.connectedRoom(orgId);

    // The events calendar first, because it is the one an admin is watching —
    // and deliberately not wrapped the way the rooms below are. If this one
    // cannot be read, the import is not the thing the admin pressed the
    // button for, and reporting the rooms as a success would read as "done"
    // for a run that silently produced no events at all.
    if (org.eventsCalendarId) {
      const { entries, skipped } = await this.read(
        source,
        org.eventsCalendarId,
        from,
        to,
        org.timezone,
      );
      const written = dryRun ? 0 : await this.writeEvents(org, entries);

      summary.calendars.push({
        id: org.eventsCalendarId,
        name: 'Events',
        kind: 'events',
        found: entries.length,
        written,
      });
      summary.skipped += skipped;
      summary.events += dryRun ? entries.length : written;
    }

    const rooms = await this.prisma.room.findMany({
      where: { orgId, googleCalendarId: { not: null } },
      select: { id: true, name: true, googleCalendarId: true },
    });

    for (const room of rooms) {
      // A room pointed at the events calendar would import the same entries
      // twice, once as an event and once as a hold on that room. Reported
      // rather than skipped in silence: an admin counting eight rooms and
      // finding seven has no way to know which one went, or why.
      if (room.googleCalendarId === org.eventsCalendarId) {
        summary.calendars.push({
          id: room.googleCalendarId,
          name: room.name,
          kind: 'shared',
          found: 0,
          written: 0,
          note: 'Uses the events calendar, so its entries are imported as events rather than twice.',
        });
        continue;
      }

      try {
        const { entries, skipped } = await this.read(
          source,
          room.googleCalendarId as string,
          from,
          to,
          org.timezone,
        );
        const written = dryRun ? 0 : await this.writeBookings(orgId, room.id, entries);

        summary.calendars.push({
          id: room.googleCalendarId as string,
          name: room.name,
          kind: 'room',
          found: entries.length,
          written,
        });
        summary.bookings += dryRun ? entries.length : written;
        summary.skipped += skipped;
      } catch (error) {
        // One room's calendar failing must not cost the co-op the others.
        this.logger.warn(`Could not read ${room.name}'s calendar: ${(error as Error).message}`);
        summary.calendars.push({
          id: room.googleCalendarId as string,
          name: room.name,
          kind: 'room',
          found: 0,
          written: 0,
          note: `Could not be read: ${(error as Error).message}`,
        });
      }
    }

    return summary;
  }

  /** Every entry in the window, following Google's paging. */
  private async read(
    source: { id: string; googleTokens: unknown },
    calendarId: string,
    from: Date,
    to: Date,
    timeZone: string,
  ): Promise<{ entries: ImportedEntry[]; skipped: number }> {
    const client = await this.calendar.clientFor(source as never);
    const entries: ImportedEntry[] = [];
    // Cancelled rows, and ones Google returns with no usable start. Counted
    // rather than quietly dropped: "nothing was skipped" and "I never
    // counted" look identical in a summary, and only one of them is true.
    let skipped = 0;
    let pageToken: string | undefined;

    do {
      const { data }: { data: calendar_v3.Schema$Events } = await client.events.list({
        calendarId,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        // Recurring entries arrive as their individual occurrences, which is
        // what a co-op means by "every Tuesday" — one row per Tuesday.
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: PAGE,
        pageToken,
      });

      for (const raw of data.items ?? []) {
        const entry = toEntry(raw, timeZone);
        if (entry && !entry.cancelled) entries.push(entry);
        else skipped += 1;
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    return { entries, skipped };
  }

  /** Whoever organised it, if MaybeOS knows them. */
  private async hostFor(orgId: string, email: string | null): Promise<string | null> {
    if (!email) return null;

    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, user: { email } },
      select: { userId: true },
    });

    return membership?.userId ?? null;
  }

  private async writeEvents(
    org: { id: string; timezone: string },
    entries: ImportedEntry[],
  ): Promise<number> {
    let written = 0;

    for (const entry of entries) {
      const hostId = await this.hostFor(org.id, entry.organiserEmail);

      await this.prisma.event.upsert({
        where: { orgId_googleEventId: { orgId: org.id, googleEventId: entry.googleEventId } },
        create: {
          orgId: org.id,
          googleEventId: entry.googleEventId,
          title: entry.title,
          slug: await this.slugFor(org.id, entry),
          description: entry.description,
          startTime: entry.start,
          endTime: entry.end,
          timezone: org.timezone,
          // Members only, by Charley's decision: a bulk import must not put
          // anything on the open internet, and single events can be made
          // public afterwards.
          visibility: 'MEMBERS_ONLY',
          isPublished: true,
          publishedAt: new Date(),
          hostId,
        },
        update: {
          // Title and times follow Google; everything a co-op has added here
          // since — a picture, tags, a longer description — is left alone.
          title: entry.title,
          startTime: entry.start,
          endTime: entry.end,
          canceledAt: null,
          ...(hostId ? { hostId } : {}),
        },
      });

      written += 1;
    }

    return written;
  }

  private async writeBookings(
    orgId: string,
    roomId: string,
    entries: ImportedEntry[],
  ): Promise<number> {
    const fallback = await this.prisma.userOrg.findFirst({
      where: { orgId, role: 'ADMIN' },
      select: { userId: true },
      orderBy: { memberSince: 'asc' },
    });
    if (!fallback) return 0;

    let written = 0;

    for (const entry of entries) {
      const userId = (await this.hostFor(orgId, entry.organiserEmail)) ?? fallback.userId;

      const existing = await this.prisma.booking.findFirst({
        where: { roomId, googleEventId: entry.googleEventId },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.booking.update({
          where: { id: existing.id },
          data: { title: entry.title, startTime: entry.start, endTime: entry.end },
        });
      } else {
        await this.prisma.booking.create({
          data: {
            roomId,
            userId,
            googleEventId: entry.googleEventId,
            title: entry.title,
            description: entry.description,
            startTime: entry.start,
            endTime: entry.end,
            // Already happening, whatever MaybeOS thinks: the room is held in
            // the calendar the co-op has actually been running on.
            status: 'APPROVED',
            visibility: 'PRIVATE',
          },
        });
      }

      written += 1;
    }

    return written;
  }

  /** A readable, unique slug — the title, then the date if that is taken. */
  private async slugFor(orgId: string, entry: ImportedEntry): Promise<string> {
    const base =
      entry.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'event';

    const taken = await this.prisma.event.findFirst({
      where: { orgId, slug: base },
      select: { id: true },
    });
    if (!taken) return base;

    // A weekly gathering imports as many rows with one title, so the date is
    // what tells them apart in an address.
    return `${base}-${entry.start.toISOString().slice(0, 10)}`;
  }
}
