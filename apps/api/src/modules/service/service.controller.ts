import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  BadRequestException,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ServiceService } from './service.service';
import { CreateDutyDto, UpdateDutyDto } from './dto/duty.dto';
import { ClaimDutyDto, CompleteClaimDto } from './dto/claim.dto';
import { HostDutyDto, HostBriefingDto, PHASES } from './dto/host-duty.dto';
import { HostBriefingService, type Phase } from './host-briefing.service';

/**
 * Serve, My Service and Serving (SRV-01) — one module, three audiences.
 *
 * Every route hangs off `orgs/:orgId` and every service method re-scopes by
 * that orgId rather than trusting the entity id in the path (SEC-04). The
 * guard proves you belong to the co-op named in the URL; it proves nothing
 * about the duty id you sent alongside it.
 */
/** A phase from the URL, or a 400. Anything else would silently match nothing. */
function assertPhase(value: string): Phase {
  const upper = (value ?? '').toUpperCase();
  if (!(PHASES as readonly string[]).includes(upper)) {
    throw new BadRequestException(`phase must be one of ${PHASES.join(', ')}`);
  }
  return upper as Phase;
}

@ApiTags('service')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class ServiceController {
  constructor(
    private readonly service: ServiceService,
    private readonly hosting: HostBriefingService,
  ) {}

  // ── Hosting: what a host does before, during and after (SRV-03) ─────

  @Get('host-duties')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: "What hosts are asked to do around a booking" })
  hostDuties(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.hosting.listDuties(orgId);
  }

  @Post('host-duties')
  @Roles('ADMIN', 'STAFF')
  createHostDuty(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: HostDutyDto,
  ) {
    return this.hosting.createDuty(orgId, dto);
  }

  @Patch('host-duties/:dutyId')
  @Roles('ADMIN', 'STAFF')
  updateHostDuty(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @Body() dto: HostDutyDto,
  ) {
    return this.hosting.updateDuty(orgId, dutyId, dto);
  }

  @Delete('host-duties/:dutyId')
  @Roles('ADMIN', 'STAFF')
  removeHostDuty(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
  ) {
    return this.hosting.removeDuty(orgId, dutyId);
  }

  @Get('host-briefings')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'The messages hosts are sent, and when' })
  hostBriefings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.hosting.listBriefings(orgId);
  }

  @Put('host-briefings/:phase')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Write the message for one phase' })
  saveHostBriefing(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('phase') phase: string,
    @Body() dto: HostBriefingDto,
  ) {
    return this.hosting.saveBriefing(orgId, assertPhase(phase), dto);
  }

  @Delete('host-briefings/:phase')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Stop sending this phase' })
  removeHostBriefing(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('phase') phase: string,
  ) {
    return this.hosting.removeBriefing(orgId, assertPhase(phase));
  }

  @Get('host-briefings/:phase/preview')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'The email as a host would receive it' })
  previewHostBriefing(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('phase') phase: string,
  ) {
    return this.hosting.preview(orgId, assertPhase(phase));
  }

  // ── Serving: an organiser names the work ────────────────────────────

  @Post('duties')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Name something that needs doing' })
  createDuty(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateDutyDto) {
    return this.service.createDuty(orgId, dto);
  }

  @Patch('duties/:dutyId')
  @Roles('ADMIN', 'STAFF')
  updateDuty(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @Body() dto: UpdateDutyDto,
  ) {
    return this.service.updateDuty(orgId, dutyId, dto);
  }

  @Delete('duties/:dutyId')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Retire a duty. Kept, not deleted, once anybody has served it' })
  removeDuty(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
  ) {
    return this.service.removeDuty(orgId, dutyId);
  }

  @Get('service/standing')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Hours by member, and who is short of their tier' })
  coopStanding(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.coopStanding(orgId);
  }

  /**
   * What members gave, for ImpactOS (SRV-02).
   *
   * Staff-only, and a count of people rather than a list of them: this is the
   * figure that ends up in a grant application, and who did the work is not a
   * funder's business.
   */
  @Get('service/contribution')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Hours members gave over a period, and what they are worth' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  contribution(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.contribution(
      orgId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('service/pending')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Claims waiting on an organiser' })
  pending(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.pendingClaims(orgId);
  }

  @Get('service/adoptions')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Who has taken something on standing, and since when' })
  adoptions(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.standingDuties(orgId);
  }

  @Post('service/claims/:claimId/confirm')
  @Roles('ADMIN', 'STAFF')
  confirm(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.confirmClaim(orgId, user.userId, claimId);
  }

  @Post('service/claims/:claimId/reject')
  @Roles('ADMIN', 'STAFF')
  reject(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.rejectClaim(orgId, user.userId, claimId);
  }

  // ── Serve: what needs doing, and taking a turn ──────────────────────

  @Get('duties')
  @ApiOperation({ summary: 'Every turn in a window, with who is on it' })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  openings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.openings(orgId, { from, to });
  }

  @Post('duties/:dutyId/claim')
  @ApiOperation({ summary: 'Take one turn or several' })
  claim(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @Body() dto: ClaimDutyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.claim(orgId, user.userId, dutyId, dto);
  }

  @Post('duties/:dutyId/adopt')
  @ApiOperation({ summary: "Take a recurring duty on standing — \"I'll do all of these\"" })
  adopt(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('dutyId', ParseUUIDPipe) dutyId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.adopt(orgId, user.userId, dutyId);
  }

  @Post('service/adoptions/:adoptionId/release')
  @ApiOperation({ summary: 'Hand a standing duty back' })
  releaseAdoption(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('adoptionId', ParseUUIDPipe) adoptionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.releaseAdoption(orgId, user.userId, adoptionId);
  }

  @Post('service/claims/:claimId/release')
  @ApiOperation({ summary: 'Give one turn back' })
  release(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.release(orgId, user.userId, claimId);
  }

  @Post('service/claims/:claimId/done')
  @ApiOperation({ summary: 'Mark a turn done and bank the minutes' })
  complete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: CompleteClaimDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.complete(orgId, user.userId, claimId, dto);
  }

  // ── My Service ──────────────────────────────────────────────────────

  @Get('my-service')
  @ApiOperation({ summary: 'What I have taken on, and what it adds up to' })
  mine(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.service.myService(orgId, user.userId);
  }
}
