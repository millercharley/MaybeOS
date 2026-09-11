import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { viewerFor } from '../../common/access/contact-visibility';
import { LedgerService } from './ledger.service';
import { ImportLedgerDto } from './dto/import-ledger.dto';

@ApiTags('members')
@Controller('orgs/:orgId')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * The member ledger (MEM-17): every member, their shares, their ownership.
   *
   * Transparent to the whole co-op by design, and to members only — not
   * guests, who are not part of the co-op whose ownership this describes.
   * No email or phone number is in the response, for any role.
   */
  @Get('ledger')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF', 'MEMBER')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The co-op's member ledger: shares and ownership, by member" })
  getLedger(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ledger.getLedger(orgId, viewerFor(user, orgId));
  }

  /** Import the co-op's cap table. Preview by default. */
  @Post('ledger/import')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Import the co-op's cap table into the member ledger" })
  importCapTable(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ImportLedgerDto,
  ) {
    return this.ledger.importCapTable(orgId, dto);
  }
}
