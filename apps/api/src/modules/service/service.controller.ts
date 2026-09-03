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

/**
 * Serve, My Service and Serving (SRV-01) — one module, three audiences.
 *
 * Every route hangs off `orgs/:orgId` and every service method re-scopes by
 * that orgId rather than trusting the entity id in the path (SEC-04). The
 * guard proves you belong to the co-op named in the URL; it proves nothing
 * about the duty id you sent alongside it.
 */
@ApiTags('service')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

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
