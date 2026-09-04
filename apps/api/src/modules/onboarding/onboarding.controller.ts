import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { OnboardingService } from './onboarding.service';
import {
  SetEnabledDto, CreateStepDto, UpdateStepDto, ReorderStepsDto,
} from './dto/onboarding.dto';

/**
 * The getting-started checklist (ONB-01).
 *
 * Two audiences on one controller. Everything under `steps` is ADMIN — it is
 * the shape of the co-op's own onboarding. Everything under `me` is any
 * member, about themselves only, and never takes a member id from the URL.
 */
@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('orgs/:orgId/onboarding')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  // ─── The member's own checklist ─────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'My getting-started checklist, or null if there is none' })
  mine(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.onboarding.forMember(orgId, user.userId);
  }

  @Post('me/steps/:stepId/complete')
  @ApiOperation({ summary: 'Tick off a custom step' })
  complete(
    @Param('orgId') orgId: string,
    @Param('stepId') stepId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.onboarding.completeStep(orgId, user.userId, stepId);
  }

  @Delete('me/steps/:stepId/complete')
  @ApiOperation({ summary: 'Un-tick a custom step' })
  uncomplete(
    @Param('orgId') orgId: string,
    @Param('stepId') stepId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.onboarding.uncompleteStep(orgId, user.userId, stepId);
  }

  @Post('me/dismiss')
  @ApiOperation({ summary: 'Put the finished checklist away for good' })
  dismiss(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.onboarding.dismiss(orgId, user.userId);
  }

  // ─── What the admin configures ──────────────────────────────

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: "The co-op's checklist configuration" })
  config(@Param('orgId') orgId: string) {
    return this.onboarding.getConfig(orgId);
  }

  @Patch()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Turn the checklist on or off' })
  setEnabled(@Param('orgId') orgId: string, @Body() dto: SetEnabledDto) {
    return this.onboarding.setEnabled(orgId, dto.enabled);
  }

  @Post('steps')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add a step' })
  createStep(@Param('orgId') orgId: string, @Body() dto: CreateStepDto) {
    return this.onboarding.createStep(orgId, dto);
  }

  @Post('steps/reorder')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Put the steps in an order' })
  reorder(@Param('orgId') orgId: string, @Body() dto: ReorderStepsDto) {
    return this.onboarding.reorderSteps(orgId, dto.stepIds);
  }

  @Patch('steps/:stepId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Edit a step' })
  updateStep(
    @Param('orgId') orgId: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateStepDto,
  ) {
    return this.onboarding.updateStep(orgId, stepId, dto);
  }

  @Delete('steps/:stepId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove a step' })
  deleteStep(@Param('orgId') orgId: string, @Param('stepId') stepId: string) {
    return this.onboarding.deleteStep(orgId, stepId);
  }
}
