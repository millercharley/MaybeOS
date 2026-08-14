import {
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
import { ConnectService } from './connect.service';
import { ConnectOnboardingDto, TicketCheckoutDto } from './dto/connect.dto';

@ApiTags('connect')
@Controller('orgs/:orgId')
export class ConnectController {
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
   * ADMIN and STAFF only. A member hosting an event can cancel it, which
   * refunds everyone; picking individual people to refund is the co-op's
   * money and the co-op's decision.
   */
  @Post('tickets/:ticketId/refund')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refund a ticket in full, including the MaybeOS fee' })
  refund(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.connectService.refundTicket(ticketId);
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
    return this.connectService.createTicketCheckout({
      orgId,
      eventId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      buyerEmail: dto.email,
      userId: user?.userId,
    });
  }
}
