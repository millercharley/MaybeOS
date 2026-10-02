import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import { PrismaService } from '../../config/prisma.service';
import { CalendarService } from './calendar.service';
import { hostFields, hostKey, hostLabel } from './past-host';
import { slugCandidates } from './event-slug';
import { deadline, nextCursor, startOf, type ImportCursor } from './import-cursor';
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
  /**
   * Entries the calendar offered that MaybeOS could not write (CAL-04).
   *
   * Distinct from `skipped`, which is a row the importer declined on purpose
   * — no id, no start, backwards. This is one it meant to take and could
   * not, and the difference matters to whoever has to go and look.
   */
  failed?: number;
  dryRun: boolean;
  /**
   * Where the next request should pick up, or null when the import is done
   * (CAL-05).
   *
   * Nine calendars and a year of entries do not fit in a Lambda's wall clock
   * — MaybeItsFate's import returned 504 — so a run stops when it is nearly
   * out of time and says where it got to. The client keeps asking until this
   * is null, which is also what lets it show progress rather than a spinner
   * that either finishes or does not.
   */
  next?: ImportCursor | null;
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
    options: { dryRun?: boolean; monthsBack?: number; resumeFrom?: ImportCursor | null } = {},
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

    const rooms = await this.prisma.room.findMany({
      where: { orgId, googleCalendarId: { not: null } },
      // Ordered, because a cursor points at a position in this list and a
      // list that comes back in a different order on the next request would
      // resume somewhere else entirely (CAL-05).
      orderBy: { id: 'asc' },
      select: { id: true, name: true, googleCalendarId: true },
    });

    // Position 0 is the events calendar when there is one, then each room.
    const sequence: Array<{ kind: 'events' } | { kind: 'room'; room: (typeof rooms)[number] }> = [
      ...(org.eventsCalendarId ? [{ kind: 'events' as const }] : []),
      ...rooms.map((room) => ({ kind: 'room' as const, room })),
    ];

    const from0 = startOf(options.resumeFrom);
    // A dry run writes nothing and finishes; only a real import is rationed.
    const outOfTime = dryRun ? () => false : deadline();
    let next: ImportCursor | null = null;

    for (let position = from0.calendar; position < sequence.length; position++) {
      const step = sequence[position];
      const startAt = position === from0.calendar ? from0.entry : 0;

      // Out of time before this calendar even starts: resume here next time
      // rather than reading it from Google for nothing.
      if (outOfTime()) {
        next = { calendar: position, entry: startAt };
        break;
      }

      if (step.kind === 'events') {
      const { entries, skipped } = await this.read(
        source,
        org.eventsCalendarId,
        from,
        to,
        org.timezone,
      );
      const slice = entries.slice(startAt);
      const failures: Array<{ title: string; reason: string }> = [];
      const written = dryRun ? 0 : await this.writeEvents(org, slice, failures, outOfTime);

      next = dryRun
        ? null
        : nextCursor(position, written + failures.length, entries.length, sequence.length, startAt);

      summary.calendars.push({
        id: org.eventsCalendarId,
        name: 'Events',
        kind: 'events',
        found: entries.length,
        written,
        // Named, not just counted (CAL-04). The first real import stopped on
        // one row and reported "request failed", which told the organiser
        // neither what broke nor that most of it had worked.
        ...(failures.length > 0 && {
          note: `${failures.length} ${failures.length === 1 ? 'event' : 'events'} could not be imported: ${failures
            .slice(0, 5)
            .map((f) => `“${f.title}”`)
            .join(', ')}${failures.length > 5 ? ', and others' : ''}`,
        }),
      });
      summary.failed = (summary.failed ?? 0) + failures.length;
      summary.skipped += skipped;
      summary.events += dryRun ? entries.length : written;

      if (next && next.calendar === position) break;
      continue;
      }

      const room = step.room;

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
        const slice = entries.slice(startAt);
        const written = dryRun
          ? 0
          : await this.writeBookings(orgId, room.id, slice, outOfTime);

        next = dryRun
          ? null
          : nextCursor(position, written, entries.length, sequence.length, startAt);

        summary.calendars.push({
          id: room.googleCalendarId as string,
          name: room.name,
          kind: 'room',
          found: entries.length,
          written,
        });
        summary.bookings += dryRun ? entries.length : written;
        summary.skipped += skipped;

        if (next && next.calendar === position) break;
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

    // Where the next request should pick up, or nothing when it is done
    // (CAL-05). The client keeps asking until this is null.
    return { ...summary, next };
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

  /**
   * Whoever organised each of these, where MaybeOS knows them (CAL-05).
   *
   * One query for the batch. This used to be a query per entry, which is
   * fine for ten events and is a third of the reason a year of a real co-op's
   * calendar could not finish inside a Lambda.
   */
  private async hostsFor(
    orgId: string,
    entries: ImportedEntry[],
  ): Promise<Map<string, string>> {
    const emails = [
      ...new Set(entries.map((e) => e.organiserEmail).filter((e): e is string => Boolean(e))),
    ];
    if (emails.length === 0) return new Map();

    const memberships = await this.prisma.userOrg.findMany({
      where: { orgId, user: { email: { in: emails } } },
      select: { userId: true, user: { select: { email: true } } },
    });

    return new Map(
      memberships
        .filter((m) => m.user.email)
        .map((m) => [m.user.email.toLowerCase(), m.userId]),
    );
  }

  /**
   * A free address for each of these, allocated together (CAL-05).
   *
   * One query for the batch, and the ones handed out in this batch are
   * remembered — two entries of the same name on the same day are in the
   * same batch, and asking the database about the second would not find the
   * first, which is not committed yet.
   */
  private async slugsFor(
    orgId: string,
    entries: ImportedEntry[],
  ): Promise<Map<string, string>> {
    const candidates = new Map(
      entries.map((entry) => [
        entry.googleEventId,
        slugCandidates(entry.title, entry.start, entry.googleEventId),
      ]),
    );

    const taken = await this.prisma.event.findMany({
      where: { orgId, slug: { in: [...candidates.values()].flat() } },
      select: { slug: true },
    });
    const used = new Set(taken.map((row) => row.slug));

    const chosen = new Map<string, string>();
    for (const [id, options] of candidates) {
      const free = options.find((slug) => !used.has(slug)) ?? options[options.length - 1];
      used.add(free);
      chosen.set(id, free);
    }

    return chosen;
  }

  /**
   * Write the events, and survive the ones that will not go (CAL-04).
   *
   * The first import of MaybeItsFate's calendar stopped on a single row — a
   * duplicate slug — and took the other nine hundred with it. A failure part
   * way through a bulk import is not a reason to abandon the rest: the ones
   * already written stay written, a re-run is an upsert and changes nothing,
   * and the only thing the organiser could not do was find out which row was
   * the problem. So a failed entry is counted and named, and the import
   * carries on.
   */
  private async writeEvents(
    org: { id: string; timezone: string },
    entries: ImportedEntry[],
    failures: Array<{ title: string; reason: string }>,
    outOfTime: () => boolean = () => false,
  ): Promise<number> {
    let written = 0;

    // Two queries for the whole batch instead of two per entry (CAL-05).
    const hosts = await this.hostsFor(org.id, entries);
    const slugs = await this.slugsFor(org.id, entries);

    for (const entry of entries) {
      // Checked before the write, never during: a chunk that stops here has
      // written everything it counted, and the cursor it returns is true.
      if (outOfTime()) break;

      try {
      const matched = entry.organiserEmail ? (hosts.get(entry.organiserEmail) ?? null) : null;
      // A host who is not a member still ran it (CAL-03). Their name goes on
      // the event; their address is kept to match them if they come back.
      const host = hostFields(matched, entry.organiserEmail, entry.organiserName);

      await this.prisma.event.upsert({
        where: { orgId_googleEventId: { orgId: org.id, googleEventId: entry.googleEventId } },
        create: {
          orgId: org.id,
          googleEventId: entry.googleEventId,
          title: entry.title,
          slug: slugs.get(entry.googleEventId) ?? entry.googleEventId,
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
          ...host,
        },
        update: {
          // Title and times follow Google; everything a co-op has added here
          // since — a picture, tags, a longer description — is left alone.
          title: entry.title,
          startTime: entry.start,
          endTime: entry.end,
          canceledAt: null,
          // A re-run must not wipe a host an organiser has since set by hand,
          // but it may fill one that is still unknown.
          ...(host.hostId || host.hostEmail ? host : {}),
        },
      });

        written += 1;
      } catch (error) {
        // Named by title, because that is what the organiser is looking at in
        // their own calendar when they go to find it.
        failures.push({ title: entry.title, reason: (error as Error).message });
        this.logger.warn(`Could not import "${entry.title}": ${(error as Error).message}`);
      }
    }

    return written;
  }

  private async writeBookings(
    orgId: string,
    roomId: string,
    entries: ImportedEntry[],
    outOfTime: () => boolean = () => false,
  ): Promise<number> {
    const fallback = await this.prisma.userOrg.findFirst({
      where: { orgId, role: 'ADMIN' },
      select: { userId: true },
      orderBy: { memberSince: 'asc' },
    });
    if (!fallback) return 0;

    let written = 0;

    const hosts = await this.hostsFor(orgId, entries);

    for (const entry of entries) {
      if (outOfTime()) break;

      const matched = entry.organiserEmail ? (hosts.get(entry.organiserEmail) ?? null) : null;
      // `userId` is required, so an unmatched reservation still has to be
      // filed under somebody — but it no longer *claims* to be theirs.
      const userId = matched ?? fallback.userId;
      const bookedFor = matched
        ? { bookedForEmail: null, bookedForName: null }
        : {
            bookedForEmail: hostKey(entry.organiserEmail),
            bookedForName: hostLabel(entry.organiserName, entry.organiserEmail),
          };

      const existing = await this.prisma.booking.findFirst({
        where: { roomId, googleEventId: entry.googleEventId },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.booking.update({
          where: { id: existing.id },
          data: { title: entry.title, startTime: entry.start, endTime: entry.end, ...bookedFor },
        });
      } else {
        await this.prisma.booking.create({
          data: {
            roomId,
            userId,
            ...bookedFor,
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

  /**
   * A readable address for an event, and one that is free (CAL-04).
   *
   * This used to try the title, then the title with the date, and use the
   * second whether or not it was taken — so a co-op with two things of the
   * same name on the same day hit the unique constraint on (orgId, slug) and
   * the whole import stopped. MaybeItsFate's first import died here.
   *
   * One query rather than one per candidate: the shortlist is small and a
   * round trip per event, per suffix, is how an import of several thousand
   * entries meets the Lambda's wall clock.
   */

}
