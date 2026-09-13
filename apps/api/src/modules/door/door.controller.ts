import { Controller, Get, Post, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { DoorService } from './door.service';
import { DoorSheetService } from './door-sheet.service';

@ApiTags('door')
@Controller('orgs/:orgId/door')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
@ApiBearerAuth()
export class DoorController {
  constructor(
    private readonly door: DoorService,
    private readonly sheet: DoorSheetService,
  ) {}

  /**
   * The caller's own door code (DOR-01).
   *
   * Deliberately "mine" rather than `/:userId`: a member reads their own, and
   * a route that takes somebody else's id is a route somebody will eventually
   * call with somebody else's id. Organisers see codes on the members list,
   * which is a different question asked a different way.
   */
  @Get('pin')
  @ApiOperation({ summary: 'The door code belonging to the caller' })
  myPin(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.door.pinFor(orgId, user.userId);
  }

  /** Whether this server can write a co-op's sheet, and who to share it with. */
  @Get('setup')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'What this server needs before door codes can work' })
  setup() {
    return {
      googleConfigured: this.sheet.isConfigured,
      // Named so an organiser can share the sheet without going hunting in
      // Google Cloud for the address.
      shareSheetWith: this.sheet.serviceAccountEmail,
    };
  }

  /**
   * Issue codes and write the sheet now, rather than within the quarter hour.
   *
   * The same work the scheduled pass does, so pressing it twice is harmless.
   */
  @Post('sync')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Issue any missing codes and update the sheet now' })
  sync(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.door.syncOrg(orgId);
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
