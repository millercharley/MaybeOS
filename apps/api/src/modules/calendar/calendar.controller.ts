import {
  Controller,
  Get,
  Post,
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
    @Res() res: Response,
  ) {
    try {
      const { orgId, roomId } = await this.calendarService.handleCallback(
        code,
        state,
      );

      // Redirect back to the app's room settings page
      const appUrl =
        this.configService.get<string>('APP_URL') || 'http://localhost:3000';
      const redirectUrl = `${appUrl}/orgs/${orgId}/rooms/${roomId}/settings?calendar=connected`;

      return res.redirect(redirectUrl);
    } catch (err) {
      this.logger.error(`OAuth callback failed: ${err.message}`, err.stack);

      const appUrl =
        this.configService.get<string>('APP_URL') || 'http://localhost:3000';
      return res.redirect(`${appUrl}/settings?calendar=error`);
    }
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
