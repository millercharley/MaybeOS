import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdoptionScanService } from './adoption-scan.service';
import { AdoptSubscriptionsDto } from './dto/adopt-subscriptions.dto';
import { PriceToTier } from './adoption-scan';

@ApiTags('members')
@Controller('orgs/:orgId')
export class AdoptionController {
  constructor(private readonly scan: AdoptionScanService) {}

  /**
   * What adopting this co-op's existing Stripe subscriptions would do (MIG-01).
   *
   * ADMIN only, and scoped to the org in the path (SEC-04) — it reads the
   * co-op's own customers, their email addresses and what each one pays, which
   * is the roster's most private column and not a thing staff or members see.
   *
   * A GET because it is one: nothing is written, in Stripe or here.
   *
   * **The path is three segments deep on purpose.** `MemberController` has
   * `@Get('members/:userId')` and its module is registered first, so a route
   * at `members/stripe-scan` never runs — Nest matches it as a member whose id
   * is the string "stripe-scan", and the reply is that controller's, guarded
   * and plausible. `members/spotlight` next door is declared above `:userId`
   * for the same reason; from another module, ordering is not available, so
   * depth is. `adoption-route-shadowing.spec.ts` holds this down.
   */
  @Get('members/import/stripe-scan')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the co-op's existing Stripe subscriptions and report what adopting them would mean",
  })
  scanSubscriptions(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.scan.scan(orgId);
  }

  /**
   * Adopt the co-op's existing subscriptions onto memberships (MIG-02).
   *
   * **`dryRun` defaults to true**, at the DTO and again here. Two chances to
   * mean it, because the failure mode of forgetting is 371 memberships that
   * have to be unpicked by hand.
   *
   * Nothing is written in Stripe by this either — no charge, no cancellation,
   * no card. It writes only MaybeOS's side of a link to subscriptions that
   * already exist and already bill.
   */
  @Post('members/import/stripe-adopt')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link existing Stripe subscriptions to memberships' })
  adopt(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: AdoptSubscriptionsDto,
  ) {
    const mapping: PriceToTier = {};
    for (const entry of dto.mapping) mapping[entry.priceId] = entry.tierId;

    return this.scan.adopt(orgId, {
      mapping,
      dryRun: dto.dryRun !== false,
      limit: dto.limit,
      after: dto.after,
    });
  }
}
