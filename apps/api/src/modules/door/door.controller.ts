import { Body, Controller, Get, Post, Put, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { DoorService } from './door.service';
import { SetDoorScriptDto } from './dto/door-script.dto';

@ApiTags('door')
@Controller('orgs/:orgId/door')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
@ApiBearerAuth()
export class DoorController {
  constructor(private readonly door: DoorService) {}

  /**
   * The caller's own door code (DOR-01).
   *
   * Deliberately "mine" rather than `/:userId`: a member reads their own, and
   * a route that takes somebody else's id is a route somebody will eventually
   * call with somebody else's id.
   */
  @Get('pin')
  @ApiOperation({ summary: 'The door code belonging to the caller' })
  myPin(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.door.pinFor(orgId, user.userId);
  }

  /** The door script address, and whether a secret is set. Never the secret itself. */
  @Get('setup')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'How this co-op’s door script is set up' })
  setup(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.door.setup(orgId);
  }

  @Put('script')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Set the door Apps Script web app address' })
  setScript(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: SetDoorScriptDto) {
    return this.door.setScriptUrl(orgId, dto.url);
  }

  /** A new signing secret, returned this once for pasting into Script Properties. */
  @Post('secret')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Generate a new door script secret' })
  rotateSecret(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.door.rotateSecret(orgId);
  }

  @Post('test')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Check the door script answers and accepts the secret' })
  test(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.door.test(orgId);
  }

  /**
   * Issue codes and resend every row now, rather than only the changes within
   * the quarter hour. The full resend repairs a sheet someone edited by hand.
   */
  @Post('sync')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Issue any missing codes and resend the whole sheet now' })
  sync(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.door.syncOrg(orgId, { full: true });
  }

  /** New letters for one member, and the sheet rewritten on the next pass. */
  @Post('members/:userId/regenerate')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Replace a member’s door code' })
  regenerate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.door.regenerate(orgId, userId);
  }
}
