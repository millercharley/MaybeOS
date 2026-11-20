import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ShellService } from './shell.service';

/**
 * Whether somebody runs this co-op.
 *
 * The same helper the events, teaching and home controllers carry. Role comes
 * off the JWT, never a second lookup — the rule `assertMayCreateChannel` set
 * down, and the reason this takes an actor rather than wearing `@Roles`:
 * "organiser or member" is not a role gate, it is a question the service asks
 * about the caller.
 */
function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

@ApiTags('shell')
@Controller()
export class ShellController {
  constructor(private readonly shell: ShellService) {}

  /**
   * One request for the chrome every signed-in page renders (OPS-47).
   *
   * Guarded exactly as the four routes it composes are — `JwtAuthGuard` and
   * `OrgMembershipGuard` — and each composed service re-scopes its own reads
   * to the org, which is the SEC-04 rule and does not become optional because
   * a guard has already run.
   *
   * The four original routes all stay. Each is used elsewhere — the unread
   * poll, the mutation refresh — and this is an extra way to ask, not a
   * replacement.
   */
  @Get('orgs/:orgId/shell')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Everything the signed-in app shell needs' })
  appShell(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: RequestUser) {
    return this.shell.appShell(orgId, {
      userId: user.userId,
      isStaff: isStaff(user, orgId),
    });
  }
}
