import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdoptionScanService } from './adoption-scan.service';

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
   */
  @Get('members/stripe-scan')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the co-op's existing Stripe subscriptions and report what adopting them would mean",
  })
  scanSubscriptions(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.scan.scan(orgId);
  }
}
