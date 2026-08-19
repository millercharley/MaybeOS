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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { ListEventsQueryDto } from './dto/list-events.dto';
import { WalkInDto } from './dto/walk-in.dto';
import { PublishBookingEventDto } from './dto/publish-booking-event.dto';
import { viewerFor } from '../../common/access/contact-visibility';

/**
 * Organisers may act on any event in their org; a member only on the ones
 * they host. Mirrors `isStaff` in SpaceController — PLATFORM_ADMIN included so
 * support can unstick a co-op.
 */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

@ApiTags('events')
@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /* ─── Create Event ──────────────────────────────────────────── */

  /**
   * Any member of the co-op may create an event (EVT-05). Charley's decision:
   * a member should be able to go to the events system and share something,
   * not wait for an organiser to type it in for them. They become its host,
   * and may edit and cancel it afterwards.
   */
  @Post('orgs/:orgId/events')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
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
  async listByOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListEventsQueryDto,
  ) {
    return this.eventsService.listByOrg(orgId, query);
  }

  /* ─── List Public Events (no auth) ─────────────────────────── */

  @Get('orgs/:orgId/events/public')
  @ApiOperation({ summary: 'List public published events' })
  async listPublicEvents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListEventsQueryDto,
  ) {
    // `visibility` is deliberately not forwarded: this route publishes only
    // what the org has made public, and letting a caller name a visibility
    // would be asking the anonymous route to show something else.
    return this.eventsService.listPublicEvents(orgId, {
      category: query.category,
      from: query.from,
      to: query.to,
      page: query.page,
      perPage: query.perPage,
    });
  }

  /* ─── List Events Visible to a Member ──────────────────────── */

  /**
   * The portal listing for somebody signed in to this co-op.
   *
   * A sibling of the anonymous route rather than an optional-auth version of
   * it: that route is deliberately incapable of returning anything unpublished
   * or non-public, and making its behaviour depend on a header would make it
   * harder to reason about than adding one guarded route.
   *
   * Not `listByOrg`, which returns drafts and cancelled events — correct for
   * an organiser's console, wrong for the page members read.
   */
  @Get('orgs/:orgId/events/visible')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List published events visible to a member' })
  async listVisibleEvents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListEventsQueryDto,
  ) {
    // Same rule as the anonymous route: the caller does not name a visibility.
    // Membership is proven by the guard, not claimed by a query parameter.
    return this.eventsService.listPublicEvents(
      orgId,
      {
        category: query.category,
        from: query.from,
        to: query.to,
        page: query.page,
        perPage: query.perPage,
      },
      true,
    );
  }

  /* ─── Website Embed (no auth, any origin) ──────────────────── */

  /**
   * The one route in MaybeOS that answers to any website.
   *
   * The app's CORS is locked to its own domains and sends credentials, so a
   * co-op's Webflow or Squarespace site cannot read the ordinary endpoints —
   * correctly. The embed is the deliberate exception: `*` here, and nowhere
   * else, with no credentials, no cookies and no authorization header, so
   * there is nothing for a hostile page to borrow. It returns what the co-op
   * has already published publicly.
   *
   * Cached for five minutes at the edge. A co-op's events change on the order
   * of days, and this is called once per visitor to their marketing site.
   */
  @Get('embed/:orgSlug/events')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Public events for a co-op, for a website embed' })
  async embedEvents(@Param('orgSlug') orgSlug: string) {
    return this.eventsService.listEmbedEvents(orgSlug);
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

  // Declared before `:eventId`: Nest matches in order, so a literal path
  // segment placed after a parameterised one is never reached — the id route
  // would take "my-rsvps" and fail its UUID pipe. Same reason /public and the
  // feeds sit above it.
  @Get('orgs/:orgId/events/my-rsvps')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's RSVPs for this organization" })
  listMyRsvps(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.listUserRsvps(orgId, user.userId);
  }

  // Above the `:eventId` route for the same reason as my-rsvps: Nest matches
  // in order, so the id route would swallow "my-events" and fail its UUID pipe.
  @Get('orgs/:orgId/events/my-events')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Events the current user hosts, drafts included' })
  listMyEvents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.listHostedEvents(orgId, user.userId);
  }

  @Get('orgs/:orgId/events/:eventId')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event details' })
  async findById(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.findById(orgId, eventId, viewerFor(user, orgId));
  }

  /**
   * Publish an event from a room booking (EVT-05) — the other way in. The
   * member already said when and where by booking the room.
   */
  @Post('orgs/:orgId/bookings/:bookingId/event')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish an event from a confirmed booking' })
  async createFromBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: PublishBookingEventDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.createFromBooking(
      orgId,
      bookingId,
      user.userId,
      isStaff(user, orgId),
      dto,
    );
  }

  /* ─── Update Event ──────────────────────────────────────────── */

  @Patch('orgs/:orgId/events/:eventId')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an event' })
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.update(orgId, eventId, dto, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /* ─── Publish Event ─────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/publish')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish an event' })
  async publish(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.publish(orgId, eventId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /* ─── Cancel Event ──────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/cancel')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel an event' })
  async cancel(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.cancel(orgId, eventId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /* ─── RSVP ──────────────────────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/rsvp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'RSVP to an event (members) or as guest' })
  async rsvp(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RsvpDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.rsvp(orgId, eventId, user?.userId ?? null, dto);
  }

  /* ─── Guest RSVP (no auth) ─────────────────────────────────── */

  @Post('orgs/:orgId/events/:eventId/rsvp/guest')
  @ApiOperation({ summary: 'Guest RSVP to a public event (no auth required)' })
  async guestRsvp(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RsvpDto,
  ) {
    return this.eventsService.rsvp(orgId, eventId, null, dto);
  }

  /* ─── Cancel RSVP ──────────────────────────────────────────── */

  @Delete('orgs/:orgId/events/:eventId/rsvp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel your RSVP' })
  async cancelRsvp(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.cancelRsvp(orgId, eventId, user.userId);
  }

  /* ─── Check-in ──────────────────────────────────────────────── */

  // Not @Roles('ADMIN','STAFF'): the person on the door is the host, who is
  // usually an ordinary member. The service decides, through loadEventForActor,
  // so a host reaches only their own event and an organiser reaches any.
  @Get('orgs/:orgId/events/:eventId/attendees')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The door list for an event' })
  async listAttendees(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.listAttendees(orgId, eventId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  /**
   * Keyed on the RSVP, not the user. The previous signature took a user id,
   * so a guest RSVP — which has no user — could never be checked in.
   */
  @Post('orgs/:orgId/events/:eventId/rsvps/:rsvpId/check-in')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark an RSVP as arrived' })
  async checkIn(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rsvpId', ParseUUIDPipe) rsvpId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.checkIn(orgId, eventId, rsvpId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Delete('orgs/:orgId/events/:eventId/rsvps/:rsvpId/check-in')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Undo a check-in' })
  async undoCheckIn(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('rsvpId', ParseUUIDPipe) rsvpId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.undoCheckIn(orgId, eventId, rsvpId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }

  @Post('orgs/:orgId/events/:eventId/walk-ins')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record somebody who arrived without an RSVP' })
  async recordWalkIn(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: WalkInDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.eventsService.recordWalkIn(
      orgId,
      eventId,
      { userId: user.userId, isStaff: isStaff(user, orgId) },
      dto.name,
    );
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
