import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportService } from './report.service';

/**
 * A published impact report, to anybody (IMP-22).
 *
 * The one unauthenticated route in ImpactOS, and deliberately so: a report a
 * co-op cannot send to a funder is not a report. Everything else in the
 * module — signals, plan, a member's own answers — stays behind auth.
 *
 * Its own controller rather than a public route hiding among org-scoped ones.
 * A file where every route is guarded and one is not is how an unguarded
 * route stops being noticed.
 *
 * **Nothing below the suppression threshold is in these blocks to begin
 * with** (see `ReportService`), so this endpoint cannot leak a small cell by
 * forgetting to filter — there is nothing to filter. Drafts are *not found*
 * rather than forbidden: confirming that a co-op has an unpublished report is
 * itself something it did not choose to share.
 */
@ApiTags('impact')
@Controller()
export class PublicReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('public/reports/:orgSlug/:reportSlug')
  @ApiOperation({ summary: 'A published impact report — no authentication' })
  getPublicReport(
    @Param('orgSlug') orgSlug: string,
    @Param('reportSlug') reportSlug: string,
  ) {
    return this.reports.getPublic(orgSlug, reportSlug);
  }
}
