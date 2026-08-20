import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { PlatformService } from './platform.service';
import { SuspendOrgDto, SetPlanDto } from './dto/platform.dto';

/**
 * The super-admin console (PLT-01).
 *
 * Its own controller, under `/platform`, entirely outside the `orgs/:orgId`
 * tree — because everything in that tree is guarded by *membership*, and the
 * point of this module is that platform administration is not membership. A
 * platform route living among org routes is how one ends up sharing the
 * wrong guard.
 *
 * **There is no endpoint here that grants `PLATFORM_ADMIN`**, deliberately: a
 * role that can grant itself is not a role, and a console that could promote
 * its own operator would make the boundary it enforces decorative. The role
 * is set outside the product by somebody with database access.
 */
@ApiTags('platform')
@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('summary')
  @ApiOperation({ summary: 'The platform in one number each' })
  summary() {
    return this.platform.summary();
  }

  @Get('orgs')
  @ApiOperation({ summary: 'Every co-op on MaybeOS, newest first' })
  listOrgs() {
    return this.platform.listOrgs();
  }

  @Post('orgs/:orgId/suspend')
  @ApiOperation({ summary: 'Stop a co-op being used. Nothing is deleted.' })
  suspend(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SuspendOrgDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.platform.suspend(orgId, user.userId, dto.reason);
  }

  @Post('orgs/:orgId/restore')
  @ApiOperation({ summary: 'Let a suspended co-op back in' })
  restore(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.platform.restore(orgId, user.userId);
  }

  @Post('orgs/:orgId/plan')
  @ApiOperation({ summary: 'Set a co-op’s plan, or stop charging it for one' })
  setPlan(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SetPlanDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.platform.setPlan(orgId, user.userId, dto);
  }
}
