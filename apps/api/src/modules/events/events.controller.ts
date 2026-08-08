import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Res,
  Header,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';

@ApiTags('events')
@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /* ─── Create Event ──────────────────────────────────────────── */

  @Post('orgs/:orgId/events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new event' })
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.create(orgId, dto, user.userId);
  }

  /* ─── List Events (authenticated) ──────────────────────────── */

  @Get('orgs/:orgId/events')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List events for an organization' })
  @ApiQuery({ name: 'visibility', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listByOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('visibility') visibility?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.eventsService.listByOrg(orgId, {
      visibility,
      category,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }

  /* ─── List Public Events (no auth) ─────────────────────────── */

  @Get('orgs/:orgId/events/public')
  @ApiOperation({ summary: 'List public published events' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listPublicEvents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.eventsService.listPublicEvents(orgId, {
      category,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      perPage: perPage ? parseInt(perPage, 10) : undefined,
    });
  }

  /* ─── JSON Feed (no auth, cached) ──────────────────────────── */

  @Get('orgs/:orgId/events/feed.json')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Public JSON feed of events' })
  async jsonFeed(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.eventsService.getEventJsonFeed(orgId);
  }

  /* ─── ICS Feed (no auth, text/calendar) ────────────────────── */

  @Get('orgs/:orgId/events/feed.ics')
  @ApiOperation({ summary: 'ICS calendar feed of events' })
  async icsFeed(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Res() res: Response,
  ) {
    const icsString = await this.eventsService.getEventIcsFeed(orgId);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="events.ics"');
    res.send(icsString);
  }

  /* ─── Get Event by ID ──────────────────────────────────────── */

  @Get('orgs/:orgId/events/:eventId')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event details' })
  async findById(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.eventsService.findById(eventId);
  }

  /* ─── Update Event ──────────────────────────────────────────── */

  @Patch('orgs/:orgId/events/:eventId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(eventId, dto);
  }

  /* ─── Publish Event ─────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish an event' })
  async publish(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.eventsService.publish(eventId);
  }

  /* ─── Cancel Event ──────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an event' })
  async cancel(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.eventsService.cancel(eventId);
  }

  /* ─── RSVP ──────────────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/rsvp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'RSVP to an event (members) or as guest' })
  async rsvp(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RsvpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.rsvp(eventId, user?.userId ?? null, dto);
  }

  /* ─── Guest RSVP (no auth) ─────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/rsvp/guest')
  @ApiOperation({ summary: 'Guest RSVP to a public event (no auth required)' })
  async guestRsvp(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RsvpDto,
  ) {
    return this.eventsService.rsvp(eventId, null, dto);
  }

  /* ─── Cancel RSVP ──────────────────────────────────────────── */

  @Delete('orgs/:orgId/events/:eventId/rsvp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel your RSVP' })
  async cancelRsvp(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.cancelRsvp(eventId, user.userId);
  }

  /* ─── Check-in ──────────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/check-in/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check in a user at an event' })
  async checkIn(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.eventsService.checkIn(eventId, userId);
  }

  /* ─── Public Event Page (by slugs, no auth) ────────────────── */

  @Get('public/events/:orgSlug/:eventSlug')
  @ApiOperation({ summary: 'Get public event page by org and event slugs' })
  async getPublicEventBySlug(
    @Param('orgSlug') orgSlug: string,
    @Param('eventSlug') eventSlug: string,
  ) {
    return this.eventsService.getPublicEventBySlug(orgSlug, eventSlug);
  }
}
