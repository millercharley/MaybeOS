import {
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

    // Store tokens on the room (as JSON; in production, encrypt at rest)
    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        googleTokens: tokens as any,
      },
    });

    this.logger.log(
      `Google Calendar tokens stored for room ${roomId} in org ${orgId}`,
    );

    return { orgId, roomId };
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
    const client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URI'),
    );

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
    const calendarId = room.googleCalendarId || 'primary';

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
    const calendarId = room.googleCalendarId || 'primary';

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
    const calendarId = room.googleCalendarId || 'primary';

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
    const calendarId = room.googleCalendarId || 'primary';

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
    const calendarId = room.googleCalendarId || 'primary';

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
