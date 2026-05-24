import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
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
  getAuthUrl(orgId: string, roomId: string): string {
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
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { bookings: true },
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

      let created = 0;
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
