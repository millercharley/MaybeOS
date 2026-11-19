import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { HomeService } from './home.service';

export class MemberHomeQueryDto {
  @ApiPropertyOptional({ example: '2026-11-19T05:00:00.000Z', description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  from?: string;
}

/**
 * Whether somebody runs this co-op.
 *
 * The same helper the events and teaching controllers carry. Role comes off
 * the JWT, never a second lookup — the rule `assertMayCreateChannel` set down.
 */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

@ApiTags('home')
@Controller()
export class HomeController {
  constructor(private readonly home: HomeService) {}

  /**
   * One request for the member dashboard (OPS-46).
   *
   * Guarded exactly as the ten routes it composes are — `JwtAuthGuard` and
   * `OrgMembershipGuard` — and each composed service re-scopes its own reads
   * to the org, which is the SEC-04 rule and does not become optional because
   * a guard has already run.
   */
  @Get('orgs/:orgId/member-home')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Everything the member dashboard's own panels need" })
  memberHome(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Query() query: MemberHomeQueryDto,
  ) {
    return this.home.memberHome(
      orgId,
      { userId: user.userId, isStaff: isStaff(user, orgId) },
      query.from,
    );
  }
}
