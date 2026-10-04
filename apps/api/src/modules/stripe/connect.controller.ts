import {
  Logger,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';

/**
 * Organisers act on any event in their co-op; everybody else only on the ones
 * they run (EVT-33). Mirrors the helper in EventsController and
 * SpaceController — PLATFORM_ADMIN included so support can unstick a co-op.
 */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}
import { ConnectService } from './connect.service';
import { forMember } from './stripe-error';
import { ConnectOnboardingDto, TicketCheckoutDto } from './dto/connect.dto';

@ApiTags('connect')
@Controller('orgs/:orgId')
export class ConnectController {
  private readonly logger = new Logger(ConnectController.name);

  constructor(private readonly connectService: ConnectService) {}

  /**
   * Connecting a Stripe account is the co-op agreeing to take money in its own
   * name, so it is ADMIN only — not staff, and certainly not any member.
   */
  @Post('connect/onboarding')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start or resume Stripe Connect onboarding' })
  onboarding(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ConnectOnboardingDto,
  ) {
    return this.connectService.createOnboardingLink(orgId, dto.returnUrl, dto.refreshUrl);
  }

  /**
   * Send an admin who already has Stripe to Stripe's own authorize page
   * (PAY-05). Same permission as creating an account: connecting one is the
   * co-op agreeing to take money in its name.
   */
  @Post('connect/oauth/start')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect an existing Stripe account' })
  startOAuth(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.connectService.buildOAuthUrl(orgId, user.userId);
  }

  @Get('connect/status')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Whether this co-op can take payments yet' })
  status(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.connectService.refreshAccountStatus(orgId);
  }

  /**
   * Refund one ticket — a buyer who asked, or a mistake.
   *
   * Whoever runs the event: an organiser, the host, the creator, or a
   * co-host (EVT-41). This was ADMIN and STAFF only, on the reasoning that
   * picking individual people to refund was the co-op's money and the
   * co-op's decision. It still is the co-op's money — but the person asking
   * for a refund writes to the host, and a host who has to find an organiser
   * to undo their own sale is a host who stops selling tickets.
   *
   * The guard is in the service, because the answer is not a role: a host is
   * an ordinary member of the co-op.
   */
  @Post('tickets/:ticketId/refund')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refund a ticket in full, including the MaybeOS fee' })
  refund(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: RequestUser,
  ) {
    // The org was previously ignored — `_orgId` — so the only thing standing
    // between an admin and another co-op's sale was not knowing the id.
    return this.connectService.refundTicket(orgId, ticketId, {
      userId: user.userId,
      isOrganiser: isStaff(user, orgId),
    });
  }

  /**
   * The tickets sold for an event (EVT-33).
   *
   * Whoever runs it: an organiser, the host, the creator, or a co-host.
   * Knowing who is coming is most of running an event, and a co-host asked to
   * help with the door could not see the door.
   *
   * Still not every member — this is a list of who paid what. The guard is in
   * the service because the answer is not a role: a host is an ordinary
   * member of the co-op.
   */
  @Get('events/:eventId/tickets')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tickets sold for an event' })
  async listTickets(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.connectService.assertRunsEvent(orgId, eventId, {
      userId: user.userId,
      isOrganiser: isStaff(user, orgId),
    });

    return this.connectService.listTicketsForEvent(orgId, eventId);
  }

  /**
   * Buying a ticket. Deliberately not guarded: a public event's tickets have
   * to be buyable by somebody with no account, which is most of the public.
   * The service refuses anything that is not a published, on-sale, public
   * event with room left.
   */
  @Post('events/:eventId/tickets/checkout')
  @ApiOperation({ summary: 'Buy a ticket to an event' })
  checkout(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: TicketCheckoutDto,
    @CurrentUser() user?: RequestUser,
  ) {
    // A ticket buyer may be a stranger who is not even a member, which makes
    // raw Stripe text on this route the most public of the three.
    return forMember(
      () =>
        this.connectService.createTicketCheckout({
          orgId,
          eventId,
          successUrl: dto.successUrl,
          cancelUrl: dto.cancelUrl,
          buyerEmail: dto.email,
          userId: user?.userId,
        }),
      (err) =>
        this.logger.error(
          `Ticket checkout failed for org ${orgId}, event ${eventId}: [${err.type}] ${err.message}`,
        ),
    );
  }
}
