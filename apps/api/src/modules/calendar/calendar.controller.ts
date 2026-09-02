import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Param,
  Query,
  Res,
  UseGuards,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CalendarService } from './calendar.service';
import { PrismaService } from '../../config/prisma.service';
import { SelectCalendarDto } from './dto/select-calendar.dto';

@ApiTags('calendar')
@Controller()
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    private readonly calendarService: CalendarService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // OAuth: Connect Google Calendar
  // ──────────────────────────────────────────────────────────────

  @Get('orgs/:orgId/rooms/:roomId/calendar/connect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Google Calendar OAuth URL to connect a room' })
  getOAuthUrl(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
  ) {
    const url = this.calendarService.getAuthUrl(orgId, roomId);
    return { url };
  }

  // ──────────────────────────────────────────────────────────────
  // OAuth: Callback (no auth — Google redirects here)
  // ──────────────────────────────────────────────────────────────

  @Get('calendar/oauth/callback')
  @ApiOperation({ summary: 'Google OAuth callback (redirects back to app)' })
  async handleOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // Read before the exchange, so the failure path knows where to send the
    // admin back to. Doing this inside the try meant any error at all landed
    // on a generic page with no way back to the room.
    const target = await this.roomsUrl(state);

    // The admin pressed Cancel on Google's consent screen. Not an error, and
    // telling them something went wrong when they chose to stop is a lie.
    if (error) {
      return res.redirect(`${target}?calendar=canceled`);
    }

    try {
      const { roomId } = await this.calendarService.handleCallback(code, state);

      // Back to the rooms page, where the calendar picker is waiting: the
      // account is connected but no calendar has been chosen for the room yet
      // (SPC-07), and that choice is the admin's.
      return res.redirect(`${target}?calendar=connected&room=${roomId}`);
    } catch (err) {
      this.logger.error(`OAuth callback failed: ${err.message}`, err.stack);
      return res.redirect(`${target}?calendar=error`);
    }
  }

  /**
   * Where to send the admin when Google sends them back.
   *
   * This used to be `${APP_URL}/admin/rooms`, and `/admin/rooms` is not a
   * route — `/admin/[orgSlug]` matches it, so connecting a calendar landed the
   * admin on the dashboard of a co-op called "rooms". The org is in the OAuth
   * state, so its slug is knowable here; a `state` we cannot parse falls back
   * to the org switcher rather than to a URL that cannot resolve.
   */
  private async roomsUrl(state: string): Promise<string> {
    const appUrl = (
      this.configService.get<string>('WEB_URL') ||
      this.configService.get<string>('APP_URL') ||
      'http://localhost:3000'
    )
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');

    try {
      const { orgId } = JSON.parse(state) as { orgId?: string };
      const org = orgId
        ? await this.prisma.organization.findUnique({
            where: { id: orgId },
            select: { slug: true },
          })
        : null;

      if (org?.slug) return `${appUrl}/admin/${org.slug}/rooms`;
    } catch {
      // Falls through to the switcher below.
    }

    return `${appUrl}/admin`;
  }

  // ──────────────────────────────────────────────────────────────
  // Choosing a calendar (SPC-07)
  // ──────────────────────────────────────────────────────────────

  @Get('orgs/:orgId/rooms/:roomId/calendar/calendars')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the calendars this room can be pointed at' })
  async listCalendars(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
  ) {
    // Scoped through the org in the path (SEC-04); the role guard proves the
    // caller is an admin somewhere, not that the room is theirs.
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      // Listing calendars calls Google as the room. The object stays
      // server-side; only ids and names go back.
      omit: { googleTokens: false },
    });

    if (!room) throw new NotFoundException('Room not found');
    if (!room.googleTokens) {
      return { connected: false, calendars: [] };
    }

    return {
      connected: true,
      account: room.googleAccountEmail,
      selectedId: room.googleCalendarId,
      calendars: await this.calendarService.listCalendars(room),
    };
  }

  @Put('orgs/:orgId/rooms/:roomId/calendar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Choose which Google calendar this room uses' })
  selectCalendar(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
    @Body() dto: SelectCalendarDto,
  ) {
    return this.calendarService.selectCalendar(orgId, roomId, dto.calendarId);
  }

  @Delete('orgs/:orgId/rooms/:roomId/calendar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect this room from Google Calendar' })
  disconnect(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
  ) {
    return this.calendarService.disconnect(orgId, roomId);
  }

  // ──────────────────────────────────────────────────────────────
  // Sync
  // ──────────────────────────────────────────────────────────────

  @Post('orgs/:orgId/rooms/:roomId/calendar/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger a full sync of the room calendar with Google' })
  async syncCalendar(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
  ) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, orgId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const result = await this.calendarService.syncRoomCalendar(roomId);
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  // Free/Busy
  // ──────────────────────────────────────────────────────────────

  @Get('orgs/:orgId/rooms/:roomId/calendar/freebusy')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check room availability via Google Calendar free/busy' })
  @ApiQuery({ name: 'start', description: 'Start time (ISO 8601)', required: true })
  @ApiQuery({ name: 'end', description: 'End time (ISO 8601)', required: true })
  async checkFreeBusy(
    @Param('orgId') orgId: string,
    @Param('roomId') roomId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    // Scoped to the org in the path (SEC-04). The membership guard only
    // proves the caller belongs to that org, not that the room does.
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      // checkFreeBusy calls Google as the room, so this read needs the tokens
      // the client omits by default. The room object stays server-side.
      omit: { googleTokens: false },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const busyPeriods = await this.calendarService.checkFreeBusy(
      room,
      new Date(start),
      new Date(end),
    );

    return { busy: busyPeriods };
  }
}
