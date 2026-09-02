import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../config/prisma.service';

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly oauth2Client: OAuth2Client;

  private static readonly SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  // ──────────────────────────────────────────────────────────────
  // OAuth Flow
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate the Google OAuth consent URL.
   * The `state` parameter encodes the orgId and roomId so the callback
   * can associate the tokens with the correct room.
   */
  /**
   * The Google settings that are missing, by name.
   *
   * The redirect URI counts. Google rejects an OAuth request whose
   * `redirect_uri` is empty or is not one of the client's registered URIs,
   * and it rejects it on Google's own page — so leaving it out of this check
   * reproduces exactly the failure the check exists to prevent: a connect
   * button that succeeds locally and strands the admin on an error page
   * that says nothing about MaybeOS.
   */
  private get missingConfig(): string[] {
    return (
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const
    ).filter((key) => !this.configService.get<string>(key)?.trim());
  }

  /** Whether Google credentials are present at all. */
  get isConfigured(): boolean {
    return this.missingConfig.length === 0;
  }

  getAuthUrl(orgId: string, roomId: string): string {
    // Without this, an unconfigured server answered 200 with a perfectly
    // shaped Google URL carrying `client_id=""` — so "Connect calendar"
    // succeeded, sent the admin to Google, and landed them on an invalid_client
    // error page with nothing explaining why. Found by executing the route
    // (SPC-04); GOOGLE_CLIENT_ID has never been set in dev.
    const missing = this.missingConfig;
    if (missing.length > 0) {
      // Naming only what is actually absent: an admin who has set the client
      // id and secret and is missing the redirect URI should not be sent to
      // re-check the two things that are already right.
      throw new ServiceUnavailableException(
        `Google Calendar is not configured on this server (${missing.join(' / ')}).`,
      );
    }

    const state = JSON.stringify({ orgId, roomId });

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: CalendarService.SCOPES,
      state,
    });
  }

  /**
   * Handle the OAuth callback: exchange the authorization code for tokens
   * and store the encrypted tokens on the room record.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ orgId: string; roomId: string }> {
    const { orgId, roomId } = JSON.parse(state) as {
      orgId: string;
      roomId: string;
    };

    const { tokens } = await this.oauth2Client.getToken(code);

    // Which account just authorised. Google's primary calendar is keyed by the
    // account's own address, so this needs no extra scope and no extra consent
    // screen — and an organiser who connected the wrong account (the co-op's
    // shared login versus their own) can see that immediately instead of
    // discovering it when bookings land somewhere nobody reads.
    const accountEmail = await this.accountEmail(tokens).catch(() => null);

    // Store tokens on the room (as JSON; in production, encrypt at rest).
    // No calendar is chosen here: picking one is the admin's decision and
    // defaulting to 'primary' would point a room at somebody's personal diary
    // (SPC-07).
    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        googleTokens: tokens as any,
        googleAccountEmail: accountEmail,
        googleConnectedAt: new Date(),
      },
    });

    this.logger.log(
      `Google Calendar tokens stored for room ${roomId} in org ${orgId}`,
    );

    return { orgId, roomId };
  }

  /** The address of the account these tokens belong to. */
  private async accountEmail(tokens: unknown): Promise<string | null> {
    const client = this.newOAuthClient();
    client.setCredentials(tokens as StoredTokens);
    const calendar = google.calendar({ version: 'v3', auth: client });
    const primary = await calendar.calendars.get({ calendarId: 'primary' });
    return primary.data.id ?? null;
  }

  /** A fresh OAuth client. The instance one carries no per-room credentials. */
  private newOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Calendar Client Factory
  // ──────────────────────────────────────────────────────────────

  /**
   * Create an authenticated Google Calendar client from a room's stored tokens.
   * Automatically refreshes expired tokens and persists the new tokens.
   */
  private async getCalendarClient(
    room: { id: string; googleTokens: any },
  ): Promise<calendar_v3.Calendar> {
    if (!room.googleTokens) {
      throw new NotFoundException(
        `Room ${room.id} has no Google Calendar tokens. Connect the calendar first.`,
      );
    }

    const tokens = room.googleTokens as StoredTokens;
    const client = this.newOAuthClient();

    client.setCredentials(tokens);

    // Listen for token refresh and persist updated tokens
    client.on('tokens', async (newTokens) => {
      const merged = { ...tokens, ...newTokens };

      await this.prisma.room.update({
        where: { id: room.id },
        data: { googleTokens: merged as any },
      });

      this.logger.log(`Refreshed and stored new tokens for room ${room.id}`);
    });

    return google.calendar({ version: 'v3', auth: client });
  }

  /**
   * Which calendar this room writes to.
   *
   * This used to be `room.googleCalendarId || 'primary'`, repeated at five
   * call sites, and nothing ever set `googleCalendarId` — so every booking any
   * co-op ever made would have gone into the primary calendar of the organiser
   * who connected the room, and every entry in that organiser's personal diary
   * would have counted against the room's availability. A room with no
   * calendar chosen is a state to report, not one to guess past (SPC-07).
   */
  private calendarIdFor(room: { id: string; googleCalendarId?: string | null }): string {
    if (!room.googleCalendarId) {
      throw new BadRequestException(
        `Room ${room.id} is connected to Google but no calendar has been chosen for it yet.`,
      );
    }
    return room.googleCalendarId;
  }

  // ──────────────────────────────────────────────────────────────
  // Calendar Event CRUD
  // ──────────────────────────────────────────────────────────────


  /**
   * Put a booking on the room's Google Calendar, or take it off (SPC-04).
   *
   * This is the piece that was missing. Every method below it has worked since
   * SpaceOS was built and **nothing ever called any of them**: `SpaceModule`
   * did not import `CalendarModule`, so no booking in the product's history
   * has ever reached Google Calendar. Connecting a room's calendar did
   * nothing except store tokens.
   *
   * It lives here rather than in SpaceService so that both callers — the
   * booking lifecycle and the webhook that confirms a paid booking — can reach
   * it without SpaceModule and StripeModule having to depend on each other.
   *
   * **Never throws.** A calendar that is unreachable, a room whose tokens have
   * been revoked, or Google being down must not fail a member's booking. The
   * booking is the record; the calendar is a copy of it.
   */
  async syncBooking(
    orgId: string,
    bookingId: string,
    action: 'create' | 'update' | 'delete',
  ): Promise<{ synced: boolean; reason?: string }> {
    try {
      // Resolved through the room's org rather than by bare id: every caller
      // already knows whose booking this is, and SEC-04's guard is right that
      // an id on its own proves nothing.
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, room: { orgId } },
        include: {
          room: {
            // The tokens are omitted for every other reader (SEC-05); calling
            // Google as the room needs them, and this object stays server-side.
            omit: { googleTokens: false },
          },
        },
      });

      if (!booking) return { synced: false, reason: 'booking not found' };

      // A room with no calendar connected is the normal case, not a fault.
      if (!booking.room.googleTokens) {
        return { synced: false, reason: 'room has no calendar connected' };
      }

      // Connected but not pointed anywhere yet. Falling through to 'primary'
      // here would write the co-op's bookings into the personal diary of
      // whoever clicked Connect (SPC-07).
      if (!booking.room.googleCalendarId) {
        return { synced: false, reason: 'room has no calendar chosen yet' };
      }

      const room = booking.room as typeof booking.room & { googleTokens: unknown };

      if (action === 'delete') {
        if (!booking.googleEventId) {
          return { synced: false, reason: 'nothing on the calendar to remove' };
        }
        await this.deleteCalendarEvent(room as any, {
          id: booking.id,
          googleEventId: booking.googleEventId,
        });
        return { synced: true };
      }

      // An update with nothing to update is a create: a booking approved after
      // it was made has no calendar event yet, and treating that as an error
      // would leave the room's calendar permanently missing it.
      if (action === 'update' && booking.googleEventId) {
        await this.updateCalendarEvent(room as any, {
          id: booking.id,
          title: booking.title,
          description: booking.description ?? undefined,
          startTime: booking.startTime,
          endTime: booking.endTime,
          googleEventId: booking.googleEventId,
        });
        return { synced: true };
      }

      if (booking.googleEventId) {
        return { synced: false, reason: 'already on the calendar' };
      }

      await this.createCalendarEvent(room as any, {
        id: booking.id,
        title: booking.title,
        description: booking.description ?? undefined,
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
      return { synced: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Calendar sync (${action}) failed for booking ${bookingId}: ${reason}`);
      return { synced: false, reason };
    }
  }

  /**
   * Create a Google Calendar event for a room booking.
   * Stores the resulting googleEventId on the booking record.
   */
  async createCalendarEvent(
    room: { id: string; googleCalendarId?: string; googleTokens: any; name: string },
    booking: {
      id: string;
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
    },
  ) {
    const calendar = await this.getCalendarClient(room);
    const calendarId = this.calendarIdFor(room);

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: booking.title,
        description: booking.description || `Booking for ${room.name}`,
        start: {
          dateTime: booking.startTime.toISOString(),
        },
        end: {
          dateTime: booking.endTime.toISOString(),
        },
      },
    });

    // Store the Google Calendar event ID on the booking
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { googleEventId: event.data.id },
    });

    this.logger.log(
      `Created Google Calendar event ${event.data.id} for booking ${booking.id}`,
    );

    return event.data;
  }

  /**
   * Update an existing Google Calendar event to reflect booking changes.
   */
  async updateCalendarEvent(
    room: { id: string; googleCalendarId?: string; googleTokens: any; name: string },
    booking: {
      id: string;
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      googleEventId: string;
    },
  ) {
    if (!booking.googleEventId) {
      this.logger.warn(
        `Booking ${booking.id} has no googleEventId – skipping update`,
      );
      return null;
    }

    const calendar = await this.getCalendarClient(room);
    const calendarId = this.calendarIdFor(room);

    const event = await calendar.events.update({
      calendarId,
      eventId: booking.googleEventId,
      requestBody: {
        summary: booking.title,
        description: booking.description || `Booking for ${room.name}`,
        start: {
          dateTime: booking.startTime.toISOString(),
        },
        end: {
          dateTime: booking.endTime.toISOString(),
        },
      },
    });

    this.logger.log(
      `Updated Google Calendar event ${booking.googleEventId} for booking ${booking.id}`,
    );

    return event.data;
  }

  /**
   * Delete a Google Calendar event when a booking is canceled.
   */
  async deleteCalendarEvent(
    room: { id: string; googleCalendarId?: string; googleTokens: any },
    booking: { id: string; googleEventId: string },
  ) {
    if (!booking.googleEventId) {
      this.logger.warn(
        `Booking ${booking.id} has no googleEventId – skipping delete`,
      );
      return;
    }

    const calendar = await this.getCalendarClient(room);
    const calendarId = this.calendarIdFor(room);

    await calendar.events.delete({
      calendarId,
      eventId: booking.googleEventId,
    });

    // Clear the googleEventId on the booking
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { googleEventId: null },
    });

    this.logger.log(
      `Deleted Google Calendar event ${booking.googleEventId} for booking ${booking.id}`,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Choosing a calendar (SPC-07)
  // ──────────────────────────────────────────────────────────────

  /**
   * The calendars this room's connected account can write to.
   *
   * Read-only calendars are left out deliberately: a room needs to *put*
   * bookings somewhere, and offering a calendar the account can only read
   * would produce a choice that fails at the first booking, hours later,
   * in a log nobody reads.
   */
  async listCalendars(
    room: { id: string; googleTokens: any },
  ): Promise<{ id: string; name: string; primary: boolean }[]> {
    const calendar = await this.getCalendarClient(room);
    const { data } = await calendar.calendarList.list({ minAccessRole: 'writer' });

    return (data.items ?? [])
      .filter((c) => c.id)
      .map((c) => ({
        id: c.id,
        name: c.summary ?? c.id,
        primary: Boolean(c.primary),
      }));
  }

  /**
   * Point a room at one of those calendars.
   *
   * The id is checked against the account's own list rather than trusted from
   * the request: a calendar the account cannot write to would be accepted
   * here and then fail on every booking.
   */
  async selectCalendar(orgId: string, roomId: string, calendarId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      omit: { googleTokens: false },
    });

    if (!room) throw new NotFoundException('Room not found');
    if (!room.googleTokens) {
      throw new BadRequestException(
        'Connect this room to Google before choosing a calendar.',
      );
    }

    const choices = await this.listCalendars(room as any);
    const chosen = choices.find((c) => c.id === calendarId);

    if (!chosen) {
      throw new BadRequestException(
        'That calendar is not one this Google account can write to.',
      );
    }

    return this.prisma.room.update({
      where: { id: room.id },
      data: { googleCalendarId: chosen.id, googleCalendarName: chosen.name },
      select: {
        id: true,
        googleCalendarId: true,
        googleCalendarName: true,
        googleAccountEmail: true,
      },
    });
  }

  /**
   * Disconnect a room from Google.
   *
   * The token is revoked at Google as well as dropped here. Deleting our copy
   * alone would leave a live grant on the organiser's account with nothing in
   * either interface to show for it.
   *
   * Existing calendar events are left where they are: they are that co-op's
   * record of what was booked, and deleting a term's worth of entries out of
   * somebody's calendar because they changed an integration is not a decision
   * this button is allowed to make.
   */
  async disconnect(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      omit: { googleTokens: false },
    });

    if (!room) throw new NotFoundException('Room not found');

    const tokens = room.googleTokens as unknown as StoredTokens | null;
    if (tokens?.refresh_token || tokens?.access_token) {
      try {
        const client = this.newOAuthClient();
        client.setCredentials(tokens);
        await client.revokeCredentials();
      } catch (err) {
        // A grant the member already revoked from their Google account page
        // answers 400 here. Our copy still has to go.
        this.logger.warn(
          `Revoking Google credentials for room ${roomId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.prisma.room.update({
      where: { id: room.id },
      data: {
        googleTokens: null,
        googleCalendarId: null,
        googleCalendarName: null,
        googleAccountEmail: null,
        googleConnectedAt: null,
      },
    });

    return { disconnected: true };
  }

  /**
   * Whether the room's Google Calendar already has something in this window.
   *
   * The counterpart to `syncBooking`, and the half that was missing: bookings
   * were pushed to Google and nothing was ever read back, so a co-op that put
   * a rehearsal straight into the room's calendar would still take a member's
   * booking for the same hour and confirm it.
   *
   * **Never throws.** Google being unreachable must not stop a member booking
   * a room; the local rules and the local conflict check still apply. It fails
   * open and says why, because the alternative is a co-op unable to book its
   * own rooms because somebody else's API is down.
   */
  /**
   * The same check, for a caller that has a room id and no tokens.
   *
   * The tokens are omitted from every ordinary room read (SEC-05), so the
   * booking path cannot pass a room object that carries them. Resolving it
   * here keeps them inside this service instead of widening what SpaceService
   * is allowed to load.
   */
  async busyConflictForRoom(
    orgId: string,
    roomId: string,
    startTime: Date,
    endTime: Date,
    ignoreEventId?: string | null,
  ): Promise<{ busy: boolean; reason?: string }> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      omit: { googleTokens: false },
    });

    if (!room) return { busy: false };

    return this.busyConflict(room, startTime, endTime, ignoreEventId);
  }

  async busyConflict(
    room: { id: string; googleCalendarId?: string | null; googleTokens: any },
    startTime: Date,
    endTime: Date,
    ignoreEventId?: string | null,
  ): Promise<{ busy: boolean; reason?: string }> {
    if (!room.googleTokens || !room.googleCalendarId) return { busy: false };

    try {
      const periods = await this.checkFreeBusy(room as any, startTime, endTime);

      // A booking being moved is already on this calendar, so without this it
      // collides with itself: shifting a 10–12 rehearsal to 11–13 would be
      // refused because 11–12 is "taken" — by the very booking being moved.
      // freebusy returns opaque merged periods with no event ids, so the
      // booking's own window comes from Google rather than from our record of
      // it, which is what an organiser who dragged the event in Google would
      // expect. A period that is only *partly* covered by it still counts:
      // that is somebody else's event overlapping ours.
      const own = ignoreEventId
        ? await this.eventWindow(room as any, ignoreEventId)
        : null;

      // Periods are clipped to the window already, and a zero-length one at
      // the boundary is not an overlap: a booking that starts exactly when
      // another ends is fine.
      const overlaps = periods.some((p) => {
        const start = new Date(p.start);
        const end = new Date(p.end);

        if (start >= endTime || end <= startTime) return false;
        if (own && own.start <= start && own.end >= end) return false;

        return true;
      });

      return { busy: overlaps };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Free/busy check failed for room ${room.id}; allowing the booking: ${reason}`,
      );
      return { busy: false, reason };
    }
  }

  /**
   * What the room's calendar has in a window, for the booking screen (SPC-09).
   *
   * `busyConflict` answers yes/no about one proposed booking; this returns the
   * periods themselves, because the screen crosses out specific times rather
   * than refusing a choice already made.
   *
   * **Never throws.** A room with no calendar, or Google being unreachable,
   * returns nothing busy. Failing the whole page because someone else's API is
   * down would be worse than showing slots the local rules still guard.
   */
  async busyForRoom(
    orgId: string,
    roomId: string,
    from: Date,
    to: Date,
  ): Promise<{ start: Date; end: Date }[]> {
    try {
      const room = await this.prisma.room.findFirst({
        where: { id: roomId, orgId },
        omit: { googleTokens: false },
      });

      if (!room?.googleTokens || !room.googleCalendarId) return [];

      const periods = await this.checkFreeBusy(room as any, from, to);

      return periods.map((p) => ({ start: new Date(p.start), end: new Date(p.end) }));
    } catch (err) {
      this.logger.warn(
        `Free/busy lookup failed for room ${roomId}; showing local availability only: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /** When a single event on the room's calendar starts and ends. */
  private async eventWindow(
    room: { id: string; googleCalendarId?: string | null; googleTokens: any },
    eventId: string,
  ): Promise<{ start: Date; end: Date } | null> {
    try {
      const calendar = await this.getCalendarClient(room);
      const { data } = await calendar.events.get({
        calendarId: this.calendarIdFor(room),
        eventId,
      });

      // An all-day event has `date` rather than `dateTime`. A booking is never
      // all-day, so an event that is tells us this id is not the booking's any
      // more and nothing should be excused on its account.
      if (!data.start?.dateTime || !data.end?.dateTime) return null;

      return { start: new Date(data.start.dateTime), end: new Date(data.end.dateTime) };
    } catch (err) {
      // Deleted from Google, or unreachable. Excusing nothing is the safe
      // direction: the worst case is refusing a move the organiser can retry,
      // rather than double-booking a room.
      this.logger.warn(
        `Could not read event ${eventId} for room ${room.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Free/Busy & Sync
  // ──────────────────────────────────────────────────────────────

  /**
   * Check free/busy status for a room's Google Calendar within a time range.
   * Returns an array of busy periods.
   */
  async checkFreeBusy(
    room: { id: string; googleCalendarId?: string; googleTokens: any },
    startTime: Date,
    endTime: Date,
  ): Promise<{ start: string; end: string }[]> {
    const calendar = await this.getCalendarClient(room);
    const calendarId = this.calendarIdFor(room);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: calendarId }],
      },
    });

    const busyPeriods =
      response.data.calendars?.[calendarId]?.busy || [];

    return busyPeriods.map((period) => ({
      start: period.start,
      end: period.end,
    }));
  }

  /**
   * Full sync: fetch all upcoming events from Google Calendar for a room
   * and reconcile with local bookings. Creates/updates bookings as needed.
   */
  async syncRoomCalendar(roomId: string) {
    // tenant-scoping-exempt: the only caller is the sync route, which resolves
    // the room inside the org in the path before calling this.
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { bookings: true },
      // Opting back in to the tokens the client omits by default — syncing
      // with Google is the one thing that genuinely needs them.
      omit: { googleTokens: false },
    });

    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    if (!room.googleTokens) {
      throw new NotFoundException(
        `Room ${roomId} has no Google Calendar connected`,
      );
    }

    const calendar = await this.getCalendarClient(room);
    const calendarId = this.calendarIdFor(room);

    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: new Date().toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const googleEvents = response.data.items || [];

      // Build a map of existing bookings by googleEventId for fast lookup
      const existingByGoogleId = new Map(
        room.bookings
          .filter((b) => b.googleEventId)
          .map((b) => [b.googleEventId, b]),
      );

      const created = 0;
      let updated = 0;

      for (const gEvent of googleEvents) {
        if (!gEvent.id || !gEvent.start?.dateTime || !gEvent.end?.dateTime) {
          continue;
        }

        const existing = existingByGoogleId.get(gEvent.id) as any;

        if (existing) {
          // Update existing booking if times differ
          const startChanged =
            new Date(gEvent.start.dateTime).getTime() !==
            existing.startTime.getTime();
          const endChanged =
            new Date(gEvent.end.dateTime).getTime() !==
            existing.endTime.getTime();

          if (startChanged || endChanged) {
            await this.prisma.booking.update({
              where: { id: existing.id },
              data: {
                title: gEvent.summary || existing.title,
                startTime: new Date(gEvent.start.dateTime),
                endTime: new Date(gEvent.end.dateTime),
              },
            });
            updated++;
          }
        }
        // NOTE: We intentionally do not auto-create local bookings for
        // Google Calendar events that were not created through MaybeOS.
        // This avoids phantom bookings. A future enhancement could add
        // "external event" records for visibility.
      }

      this.logger.log(
        `Calendar sync for room ${roomId}: ${googleEvents.length} events fetched, ${updated} updated`,
      );

      return {
        totalGoogleEvents: googleEvents.length,
        updated,
        created,
      };
    } catch (err) {
      this.logger.error(
        `Calendar sync failed for room ${roomId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Calendar sync failed');
    }
  }
}
