import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { SocialService } from './social.service';
import { ChoosePageDto, SocialSettingsDto } from './dto/social.dto';


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

}
