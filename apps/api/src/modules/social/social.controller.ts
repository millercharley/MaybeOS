import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { SocialService } from './social.service';
import { ChoosePageDto, MemberSocialDto, ShareEventDto, SocialSettingsDto } from './dto/social.dto';

function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

/** Connecting the co-op's Facebook Page and Instagram, and who may share (SOC-01). Admins only. */
@ApiTags('social')
@Controller('orgs/:orgId/social')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
@ApiBearerAuth()
export class SocialAdminController {
  constructor(private readonly social: SocialService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'The connected Page and sharing settings' })
  status(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.social.status(orgId);
  }

  @Post('meta/connect')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'The Facebook Login address to connect a Page' })
  connect(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.social.connectUrl(orgId, user.userId);
  }

  @Put('meta/page')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Choose which Page to connect, when the login manages several' })
  choosePage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ChoosePageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.social.choosePage(orgId, dto.pageId, user.userId);
  }

  @Delete('meta')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Disconnect the Facebook Page' })
  disconnect(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.social.disconnect(orgId);
  }

  @Patch('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Turn sharing on or off, and set the default for members' })
  settings(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: SocialSettingsDto) {
    return this.social.updateSettings(orgId, dto);
  }

  @Patch('members/:userId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Allow or stop one member sharing' })
  member(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: MemberSocialDto,
  ) {
    return this.social.setMemberAllowed(orgId, userId, dto.allowed);
  }
}

/** A host sharing one of their events (SOC-01). */
@ApiTags('social')
@Controller('orgs/:orgId/events/:eventId/social')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
@ApiBearerAuth()
export class EventShareController {
  constructor(private readonly social: SocialService) {}

  @Get()
  @ApiOperation({ summary: 'Whether this event can be shared, and where it has been' })
  options(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.social.shareOptions(orgId, eventId, { userId: user.userId, staff: isStaff(user, orgId) });
  }

  @Post()
  @ApiOperation({ summary: 'Share this event to the co-op’s Facebook Page and/or Instagram' })
  share(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ShareEventDto,
  ) {
    return this.social.share(orgId, eventId, { userId: user.userId, staff: isStaff(user, orgId) }, dto);
  }
}
