import {
  Body,
  Controller,
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
import { RecapService } from './recap.service';
import { RecapEmailsDto, RecapNoteDto, UpdateRecapSettingsDto } from './dto/recap.dto';

/**
 * The monthly recap (RCP-01).
 *
 * Reading and sending are organisers' work; the only member-facing route is
 * the switch on their own copy. There is deliberately no route that returns a
 * recap to a member: what a member gets is the email, and a draft that has
 * not been sent yet is not theirs to read.
 */
@ApiTags('recap')
@ApiBearerAuth()
@Controller('orgs/:orgId/recap')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class RecapController {
  constructor(private readonly recap: RecapService) {}

  @Get('settings')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: "The recap's switches and the last one drafted" })
  settings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.recap.settings(orgId);
  }

  @Patch('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Turn the recap on, choose the hour, decide about money' })
  updateSettings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: UpdateRecapSettingsDto,
  ) {
    return this.recap.updateSettings(orgId, dto);
  }

  @Get('latest')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'The most recent recap, drafted or sent' })
  latest(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.recap.latest(orgId);
  }

  @Get()
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Every recap this co-op has' })
  list(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.recap.list(orgId);
  }

  @Patch(':recapId/note')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: "The organiser's own words at the top" })
  setNote(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('recapId', ParseUUIDPipe) recapId: string,
    @Body() dto: RecapNoteDto,
  ) {
    return this.recap.setNote(orgId, recapId, dto.note);
  }

  @Post(':recapId/send')
  @Roles('ADMIN')
  // An admin, not staff: this is the one action that writes to every member's
  // inbox at once, and it cannot be taken back.
  @ApiOperation({ summary: 'Send the recap to every member who wants it' })
  send(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('recapId', ParseUUIDPipe) recapId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.recap.send(orgId, recapId, user.userId);
  }

  @Post('draft')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Draft last month's recap now, rather than waiting for the 1st" })
  draft(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.recap.draftFor(orgId);
  }

  @Get('emails')
  @ApiOperation({ summary: 'Whether I currently get the monthly recap' })
  myEmails(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.recap.myEmails(orgId, user.userId);
  }

  @Patch('emails')
  @ApiOperation({ summary: 'Turn my own monthly recap on or off' })
  setEmails(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RecapEmailsDto,
  ) {
    return this.recap.setRecapEmails(orgId, user.userId, dto.recapEmails);
  }
}
