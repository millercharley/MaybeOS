import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { viewerFor } from '../../common/access/contact-visibility';
import { LedgerService } from './ledger.service';
import { GrantSharesDto, ImportLedgerDto, SetTotalDto } from './dto/import-ledger.dto';

@ApiTags('members')
@Controller('orgs/:orgId')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * The Members page (MEM-17, MEM-19): every member, and — when the co-op
   * tracks them — their shares and ownership. Members only, not guests. No
   * email or phone number in the response, for any role.
   */
  @Get('ledger')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF', 'MEMBER')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The co-op's members, with shares and ownership when tracked" })
  getLedger(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.ledger.getLedger(orgId, viewerFor(user, orgId));
  }

  /** Every member with their holding, for the admin's Shares page (MEM-19). */
  @Get('ledger/admin')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Shares by member, for organisers' })
  getAdminView(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.ledger.getAdminView(orgId);
  }

  /** One member's ledger lines, newest first (MEM-19). */
  @Get('ledger/members/:userId/history')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "One member's share history" })
  getHistory(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.ledger.getHistory(orgId, userId);
  }

  /** Grant shares to one member or a selection, all or nothing (MEM-19). */
  @Post('ledger/grants')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Grant shares to one member or many' })
  grant(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: GrantSharesDto,
  ) {
    return this.ledger.grant(orgId, user.userId, dto);
  }

  /** Set a member's balance, recorded as an adjustment line (MEM-19). */
  @Post('ledger/members/:userId/total')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set one member's share balance" })
  setTotal(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetTotalDto,
  ) {
    return this.ledger.setTotal(orgId, user.userId, userId, dto);
  }

  /** Import the co-op's cap table. Preview by default. */
  @Post('ledger/import')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Import the co-op's cap table" })
  importCapTable(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: ImportLedgerDto) {
    return this.ledger.importCapTable(orgId, dto);
  }
}
