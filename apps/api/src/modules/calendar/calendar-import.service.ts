import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import { PrismaService } from '../../config/prisma.service';
import { CalendarService } from './calendar.service';
import { hostFields, hostKey, hostLabel, personFor } from './past-host';
import { guestFrom } from './booking-guest';
import { slugCandidates } from './event-slug';
import { deadline, nextCursor, startOf, type ImportCursor } from './import-cursor';
import { ImportedEntry, cancelledId, importWindow, toEntry } from './calendar-import';

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
    /**
     * How many were let go because their Google entry was deleted (CAL-12).
     *
     * Reported rather than done quietly: this is the one number in an import
     * that takes something away, and an admin who sees a room free up is owed
     * the reason.
     */
    released?: number;
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
      const resuming = position === from0.calendar;
      const startAt = resuming ? from0.entry : 0;
      const fromPage = resuming ? from0.page : null;

      // Out of time before this calendar even starts: resume here next time
      // rather than reading from Google for nothing.
      if (outOfTime()) {
        next = { calendar: position, page: fromPage, entry: startAt };
        break;
      }

      if (step.kind === 'events') {
      // A preview reads the lot to count it; a real run takes one page
      // (CAL-06), because reading every page on every chunk is what spent
      // forty requests writing 274 rows.
      const read = dryRun
        ? { ...(await this.read(source, org.eventsCalendarId, from, to, org.timezone)), nextPageToken: null }
        : await this.readPage(source, org.eventsCalendarId, from, to, org.timezone, fromPage);
      const { entries, skipped } = read;

      const slice = entries.slice(startAt);
      const failures: Array<{ title: string; reason: string }> = [];
      const written = dryRun ? 0 : await this.writeEvents(org, slice, failures, outOfTime);
      // Deletions are the page's news as much as its entries are (CAL-12).
      const cancelled = dryRun ? 0 : await this.cancelEvents(org.id, read.cancelled);

      next = dryRun
        ? null
        : nextCursor(
            position,
            sequence.length,
            { token: fromPage, nextToken: read.nextPageToken, length: entries.length },
            startAt,
            written + failures.length,
          );

      summary.calendars.push({
        id: org.eventsCalendarId,
        name: 'Events',
        kind: 'events',
        found: entries.length,
        written,
        ...(cancelled > 0 && { released: cancelled }),
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
        const read = dryRun
          ? {
              ...(await this.read(source, room.googleCalendarId as string, from, to, org.timezone)),
              nextPageToken: null,
            }
          : await this.readPage(
              source,
              room.googleCalendarId as string,
              from,
              to,
              org.timezone,
              fromPage,
            );
        const { entries, skipped } = read;

        const slice = entries.slice(startAt);
        const written = dryRun
          ? 0
          : await this.writeBookings(orgId, room.id, slice, outOfTime);
        /*
          And let go of the rooms whose entries were deleted (CAL-12).

          Run whether or not the write ran out of time: it is one statement
          over a handful of ids, and a room left booked after its entry was
          deleted is the visible half of this bug.
        */
        const cancelled = dryRun ? 0 : await this.releaseBookings(room.id, read.cancelled);

        next = dryRun
          ? null
          : nextCursor(
              position,
              sequence.length,
              { token: fromPage, nextToken: read.nextPageToken, length: entries.length },
              startAt,
              written,
            );

        summary.calendars.push({
          id: room.googleCalendarId as string,
          name: room.name,
          kind: 'room',
          found: entries.length,
          written,
          ...(cancelled > 0 && {
            released: cancelled,
            note: `${cancelled} ${cancelled === 1 ? 'booking was' : 'bookings were'} released — deleted in Google.`,
          }),
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

  /**
   * One page of a calendar, and the token for the next (CAL-06).
   *
   * The import used to read every page before writing anything, on every
   * chunk — six round trips to Google for a calendar of 1,365 entries, paid
   * again each time. Forty requests went on re-reading and 274 reservations
   * got written. One page in, one page written.
   */
  /**
   * Let a room go when its Google entry was deleted (CAL-12).
   *
   * **Cancelled, not deleted.** The booking is the co-op's record that the
   * room was held, and a member looking at why their evening vanished is
   * better served by a cancelled booking than by nothing at all. It also
   * matches what cancelling by hand does, so there is one shape of
   * "this is over" rather than two.
   *
   * `status` is what actually frees the slot — the availability query reads it
   * and never looks at `canceledAt` — so setting the timestamp alone would
   * have left the room exactly as booked as before, which is the bug this is
   * fixing one layer down.
   */
  private async releaseBookings(roomId: string, googleEventIds: string[]): Promise<number> {
    if (googleEventIds.length === 0) return 0;

    const { count } = await this.prisma.booking.updateMany({
      where: {
        roomId,
        googleEventId: { in: googleEventIds },
        // Already gone is not a change. Without this every run would restamp
        // `canceledAt` on everything ever deleted.
        status: { not: 'CANCELED' },
      },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(`Released ${count} booking(s) in room ${roomId}: deleted in Google`);
    }
    return count;
  }

  /**
   * Mark an event cancelled when its Google entry was deleted (CAL-12).
   *
   * The event stays, carrying `canceledAt`, because people may have RSVPed to
   * it and a co-op's record of what it ran should not disappear because a
   * calendar row did. The import's own update clears `canceledAt` again if the
   * entry comes back, so this is reversible by the thing that caused it.
   */
  private async cancelEvents(orgId: string, googleEventIds: string[]): Promise<number> {
    if (googleEventIds.length === 0) return 0;

    const { count } = await this.prisma.event.updateMany({
      where: { orgId, googleEventId: { in: googleEventIds }, canceledAt: null },
      data: { canceledAt: new Date() },
    });

    if (count > 0) {
      this.logger.log(`Cancelled ${count} event(s) in org ${orgId}: deleted in Google`);
    }
    return count;
  }

  private async readPage(
    source: { id: string; googleTokens: unknown },
    calendarId: string,
    from: Date,
    to: Date,
    timeZone: string,
    pageToken: string | null,
  ): Promise<{
    entries: ImportedEntry[];
    cancelled: string[];
    skipped: number;
    nextPageToken: string | null;
  }> {
    const client = await this.calendar.clientFor(source as never);
    const { data }: { data: calendar_v3.Schema$Events } = await client.events.list({
      calendarId,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: PAGE,
      // Without this Google omits deleted rows entirely (CAL-12), so a
      // deletion was not something MaybeOS handled badly — it was something
      // MaybeOS never heard about. The Attic stayed booked in the room
      // calendar after its entry was taken off the Google one.
      showDeleted: true,
      ...(pageToken ? { pageToken } : {}),
    });

    const entries: ImportedEntry[] = [];
    const cancelled: string[] = [];
    let skipped = 0;
    for (const raw of data.items ?? []) {
      const gone = cancelledId(raw);
      if (gone) {
        cancelled.push(gone);
        continue;
      }

      const entry = toEntry(raw, timeZone);
      // A shared calendar names itself as the organiser, so who the person
      // is can only be decided here, where the calendar id is known (CAL-07).
      if (entry && !entry.cancelled) entries.push({ ...entry, hostPerson: personFor(entry, calendarId) });
      else skipped += 1;
    }

    return { entries, cancelled, skipped, nextPageToken: data.nextPageToken ?? null };
  }

  /** Every entry in the window, following Google's paging. For a preview. */
  private async read(
    source: { id: string; googleTokens: unknown },
    calendarId: string,
    from: Date,
    to: Date,
    timeZone: string,
  ): Promise<{ entries: ImportedEntry[]; cancelled: string[]; skipped: number }> {
    const client = await this.calendar.clientFor(source as never);
    const entries: ImportedEntry[] = [];
    const cancelled: string[] = [];
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
        // See `readPage`: deleted rows are omitted unless asked for (CAL-12).
        showDeleted: true,
        pageToken,
      });

      for (const raw of data.items ?? []) {
        const gone = cancelledId(raw);
        if (gone) {
          cancelled.push(gone);
          continue;
        }

        const entry = toEntry(raw, timeZone);
        if (entry && !entry.cancelled) entries.push({ ...entry, hostPerson: personFor(entry, calendarId) });
        else skipped += 1;
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    return { entries, cancelled, skipped };
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
      ...new Set(entries.map((e) => e.hostPerson?.email).filter((e): e is string => Boolean(e))),
    ];
    if (emails.length === 0) return new Map();

    // Either address a member reads (MEM-19). MaybeItsFate's organisers put
    // their co-op addresses on the calendar and joined under personal ones;
    // matching only the account's own address left twelve events hosted by
    // "r" and "e" and no way for a re-import to improve on it.
    const memberships = await this.prisma.userOrg.findMany({
      where: {
        orgId,
        OR: [{ user: { email: { in: emails } } }, { altEmail: { in: emails } }],
      },
      select: { userId: true, altEmail: true, user: { select: { email: true } } },
    });

    const byEmail = new Map<string, string>();
    for (const membership of memberships) {
      if (membership.user.email) byEmail.set(membership.user.email.toLowerCase(), membership.userId);
      if (membership.altEmail) byEmail.set(membership.altEmail.toLowerCase(), membership.userId);
    }

    return byEmail;
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
      const person = entry.hostPerson ?? { email: null, name: null };
      const matched = person.email ? (hosts.get(person.email) ?? null) : null;
      // A host who is not a member still ran it (CAL-03). Their name goes on
      // the event; their address is kept to match them if they come back.
      const host = hostFields(matched, person.email, person.name);

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
          /*
            Only a matched member, and only ever as a fill.

            This read `...(host.hostId || host.hostEmail ? host : {})`, which
            spreads `hostId: null` whenever the organiser is not a member —
            so a re-import would have silently un-hosted every event an
            organiser had assigned by hand, including the twelve Charley and
            I had just matched to Rebecca and Eddie. The comment said it must
            not wipe a host; the code wiped it.

            An unmatched organiser is still recorded, but only on the way in:
            the create branch above. There is no safe way to fill a blank
            name from an upsert without also being able to clear a real one.
          */
          ...(host.hostId ? { hostId: host.hostId, hostEmail: null, hostName: null } : {}),
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

    /*
      Who the room is actually for (SPC-25).

      Every entry on a co-op's room calendar has the same creator — the
      account the booking automation runs on — so the creator says nothing
      about whose booking it is. The description does: MaybeItsFate's
      automation writes "Guest • Abby Ferree (abby.m.ferree@gmail.com)", and
      2,348 of its 3,017 reservations carry that line naming 216 people.

      The guest wins where there is one. The creator is the fallback, for a
      calendar kept by hand rather than by a booking tool.
    */
    const guests = new Map(entries.map((e) => [e.googleEventId, guestFrom(e.description)]));
    const withGuests = entries.map((entry) => {
      const guest = guests.get(entry.googleEventId);
      return guest
        ? { ...entry, hostPerson: { email: guest.email, name: guest.name } }
        : entry;
    });

    const hosts = await this.hostsFor(orgId, withGuests);

    // Which of these the room already holds — one query for the batch, not
    // one per reservation (CAL-06).
    const already = new Map(
      (
        await this.prisma.booking.findMany({
          where: {
            roomId,
            googleEventId: { in: entries.map((e) => e.googleEventId) },
          },
          select: { id: true, googleEventId: true },
        })
      ).map((row) => [row.googleEventId as string, row.id]),
    );

    for (const entry of withGuests) {
      if (outOfTime()) break;

      const person = entry.hostPerson ?? { email: null, name: null };
      const matched = person.email ? (hosts.get(person.email) ?? null) : null;
      // `userId` is required, so an unmatched reservation still has to be
      // filed under somebody — but it no longer *claims* to be theirs.
      const userId = matched ?? fallback.userId;

      /*
        Whose booking is this, really (SPC-23)?

        A co-op's room calendar is kept by whatever account its automation
        runs on. MaybeItsFate's is c@maybeitsfate.com, which is also an
        organiser's own address, so the import matched all 3,017 reservations
        to one person and put the entire history of eight rooms in his My
        Bookings.

        A reservation is somebody's only when it matched a member who is not
        the organiser it would have fallen back to anyway. Everything else is
        the co-op's: it holds the room, organisers see it, and it is in
        nobody's personal list. Under-claiming on purpose — a member missing
        an imported hold from their own list still sees the room is taken,
        while over-claiming hands one person three thousand bookings.
      */
      /*
        A reservation is somebody's when it names somebody who is a member
        here. Everything else is the co-op's: it holds the room, organisers
        see it, and it is in nobody's personal list.

        The guest line is what makes this safe. Before it, the only signal
        was the creator — identical on every entry — so "matched" meant
        "matched the automation's account", which is how one person was
        handed three thousand bookings.
      */
      const named = Boolean(guests.get(entry.googleEventId));
      const isCoopHold = matched === null || (!named && matched === fallback.userId);
      const bookedFor = matched
        ? { bookedForEmail: null, bookedForName: null }
        : {
            bookedForEmail: hostKey(person.email),
            bookedForName: hostLabel(person.name, person.email),
          };

      const existing = already.get(entry.googleEventId);

      if (existing) {
        await this.prisma.booking.update({
          where: { id: existing },
          data: {
            title: entry.title,
            startTime: entry.start,
            endTime: entry.end,
            isCoopHold,
            ...bookedFor,
          },
        });
      } else {
        await this.prisma.booking.create({
          data: {
            roomId,
            userId,
            isCoopHold,
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
