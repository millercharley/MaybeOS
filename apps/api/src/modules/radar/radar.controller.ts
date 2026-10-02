import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RadarService } from './radar.service';
import {
  CreateInterestTagDto,
  SetInterestsDto,
  SetRadarEmailsDto,
  UpdateInterestTagDto,
  UpdateRadarSettingsDto,
} from './dto/radar.dto';

/**
 * Radar (RDR-01), from both sides: an organiser running the co-op's interest
 * list and the digest, and a member saying what they care about.
 *
 * Everything here is behind a session and scoped to one co-op. A member's
 * interests are read and written **only by that member** — there is no route
 * that returns one member's interests to anybody else, and the admin numbers
 * are counts. What somebody likes is the kind of fact a co-op can be trusted
 * with in aggregate and not individually.
 */
@ApiTags('radar')
@ApiBearerAuth()
@Controller('orgs/:orgId/radar')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  // ─── The organiser's side ───────────────────────────────────

  @Get('settings')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: "Radar's switches and the co-op's interest list" })
  settings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.radar.settings(orgId);
  }

  @Patch('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Turn Radar on or off, and say when the digest goes out' })
  updateSettings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: UpdateRadarSettingsDto,
  ) {
    return this.radar.updateSettings(orgId, dto);
  }

  @Post('tags')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Add an interest to the co-op's list" })
  createTag(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateInterestTagDto) {
    return this.radar.createTag(orgId, dto.name, dto.emoji);
  }

  @Patch('tags/:tagId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Rename an interest, or take it out of use' })
  updateTag(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: UpdateInterestTagDto,
  ) {
    return this.radar.updateTag(orgId, tagId, dto);
  }

  @Delete('tags/:tagId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove an interest, or retire it if it is already in use' })
  removeTag(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.radar.removeTag(orgId, tagId);
  }

  // ─── The member's side ──────────────────────────────────────

  @Get('tags')
  @ApiOperation({ summary: "The co-op's interests, for tagging a gathering" })
  // Any member, not just an organiser: any member can host, and a host has to
  // be able to say what their gathering is. The list is the co-op's own words
  // and tells nobody anything about any member.
  tags(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.radar.tags(orgId);
  }

  @Get('interests')
  @ApiOperation({ summary: 'What I am interested in, including what MaybeOS inferred' })
  myInterests(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.radar.myInterests(orgId, user.userId);
  }

  @Patch('interests')
  @ApiOperation({ summary: 'Say what I am interested in' })
  setInterests(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetInterestsDto,
  ) {
    return this.radar.setInterests(orgId, user.userId, dto.answers);
  }

  @Get('ask')
  @ApiOperation({ summary: 'The next few interests to ask about, or nothing' })
  ask(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.radar.nextAsk(orgId, user.userId);
  }

  @Post('ask/dismiss')
  @ApiOperation({ summary: 'Not now' })
  async dismiss(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    await this.radar.dismissAsk(orgId, user.userId);
    return { dismissed: true };
  }

  @Patch('emails')
  @ApiOperation({ summary: 'Turn my Radar emails on or off' })
  setEmails(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetRadarEmailsDto,
  ) {
    return this.radar.setRadarEmails(orgId, user.userId, dto.radarEmails);
  }
}
