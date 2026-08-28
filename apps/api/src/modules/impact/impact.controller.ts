import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  ParseUUIDPipe,
  Body,
  Query,
  Param,
  Header,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ImpactService } from './impact.service';
import { GoalsService } from './goals.service';
import { ReportService } from './report.service';
import { ReportPurchaseService } from './report-purchase.service';
import { StripeService } from '../stripe/stripe.service';
import { GenerateReportDto, UpdateReportBlockDto, BuyReportDto } from './dto/report.dto';
import {
  SetMissionDto,
  CreateGoalDto,
  UpdateGoalDto,
  AddIndicatorDto,
} from './dto/goal.dto';
import { TouchpointService } from './touchpoint.service';
import { TouchpointAnswerDto } from './dto/touchpoint-answer.dto';
import { ExpenseService } from './expense.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { Touchpoint } from '@prisma/client';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { OpenWindowDto } from './dto/open-window.dto';
import { UpdateDemographicsDto } from './dto/update-demographics.dto';

@ApiTags('impact')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class ImpactController {
  constructor(
    private readonly impactService: ImpactService,
    private readonly touchpoints: TouchpointService,
    private readonly expenses: ExpenseService,
    private readonly goals: GoalsService,
    private readonly reports: ReportService,
    private readonly reportPurchases: ReportPurchaseService,
    private readonly stripe: StripeService,
  ) {}

  // ─── Surveys CRUD ───────────────────────────────────────────

  @Post('surveys')
  @Roles('ADMIN')
  createSurvey(
    @Param('orgId') orgId: string,
    @Body() dto: CreateSurveyDto,
  ) {
    return this.impactService.createSurvey(orgId, dto);
  }

  @Get('surveys')
  listSurveys(@Param('orgId') orgId: string) {
    return this.impactService.listSurveys(orgId);
  }

  // Every route below takes `orgId` as well as `surveyId`, and the service
  // refuses to touch a survey belonging to a different org. The org guard only
  // proves the caller belongs to the org *named in the URL* — which the caller
  // chooses — so the survey has to be checked against it too. See D-009.

  @Get('surveys/:surveyId')
  getSurvey(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
  ) {
    return this.impactService.getSurvey(orgId, surveyId);
  }

  @Patch('surveys/:surveyId')
  @Roles('ADMIN')
  updateSurvey(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
    @Body() dto: Partial<CreateSurveyDto>,
  ) {
    return this.impactService.updateSurvey(orgId, surveyId, dto);
  }

  @Post('surveys/:surveyId/publish')
  @Roles('ADMIN')
  publishSurvey(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
  ) {
    return this.impactService.publishSurvey(orgId, surveyId);
  }

  @Post('surveys/:surveyId/close')
  @Roles('ADMIN')
  closeSurvey(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
  ) {
    return this.impactService.closeSurvey(orgId, surveyId);
  }

  /**
   * Open a new collection window — next year's round of the same survey.
   * Responses always land in the open window, and a figure is only comparable
   * to another from the same one (D-021, G5).
   */
  @Post('surveys/:surveyId/windows')
  @Roles('ADMIN')
  openWindow(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
    @Body() dto: OpenWindowDto,
  ) {
    return this.impactService.openWindow(orgId, surveyId, dto.label, dto.closesAt);
  }

  // ─── Responses ──────────────────────────────────────────────

  @Post('surveys/:surveyId/respond')
  submitResponse(
    @Param('orgId') orgId: string,
    @Param('surveyId') surveyId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SubmitResponseDto,
  ) {
    // JwtAuthGuard runs on this controller, so there is always a user here.
    // An earlier comment claimed this could be an anonymous token-based
    // response; no such path exists, and one would need its own route outside
    // this guard rather than a null check inside it.
    return this.impactService.submitResponse(
      orgId,
      surveyId,
      user.userId,
      dto.answers,
    );
  }

  // Two endpoints used to live here: a paginated response list and a CSV
  // export, both returning individual answers alongside the respondent's name
  // and email address. Neither had a caller anywhere in the web app.
  //
  // They are not coming back in this form. Under D-021 an admin never sees how
  // an individual member answered an impact question — results reach them in
  // aggregate, with segments of fewer than five suppressed. Anything that
  // replaces these reads aggregates, not rows.
  //
  // Removing them also shrinks IMP-01: until every method scopes its survey id
  // to the org in the path, these were the two that leaked identities.

  // ─── Dashboard ──────────────────────────────────────────────

  @Get('impact/dashboard')
  @Roles('ADMIN', 'STAFF')
  getDashboard(@Param('orgId') orgId: string) {
    return this.impactService.getDashboard(orgId);
  }

  // ─── Demographic profile (IMP-17) ───────────────────────────
  //
  // Member-owned: no @Roles, because these three routes act on the caller's
  // own membership and nobody else's. There is deliberately no route that
  // reads another member's profile — the PRD makes this data member-owned,
  // and the only admin-facing view is the suppressed aggregate below.

  @Get('me/demographics')
  getMyDemographics(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.impactService.getMyDemographics(orgId, user.userId);
  }

  @Put('me/demographics')
  updateMyDemographics(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDemographicsDto,
  ) {
    return this.impactService.updateMyDemographics(orgId, user.userId, dto.answers);
  }

  @Delete('me/demographics')
  deleteMyDemographics(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.impactService.deleteMyDemographics(orgId, user.userId);
  }

  /**
   * Who the space serves, in aggregate and suppressed. Never individual rows —
   * §10: "Individual responses are never exposed to admins except in
   * aggregate."
   */
  @Get('impact/demographics')
  @Roles('ADMIN', 'STAFF')
  getDemographicSummary(@Param('orgId') orgId: string) {
    return this.impactService.getDemographicSummary(orgId);
  }

  // ─── Touchpoints (IMP-15) ───────────────────────────────────

  /**
   * The one question to ask this member at this moment, or null.
   *
   * Null is the ordinary answer and the caller renders nothing: the fatigue
   * budget (D-021) allows one question per member per 30 days across every
   * touchpoint, so most visits must ask nothing at all.
   *
   * Scoped to the caller's own membership — a member can only ever pull their
   * own question, and asking on somebody else's behalf is not a thing.
   */
  // ─── The year-end report (IMP-22) ───────────────────────────

  @Get('impact/reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  listReports(@Param('orgId') orgId: string) {
    return this.reports.list(orgId);
  }

  @Get('impact/reports/:reportId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  getReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.reports.get(orgId, reportId);
  }

  @Post('impact/reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Write a report from what the co-op collected' })
  generateReport(
    @Param('orgId') orgId: string,
    @Body() dto: GenerateReportDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reports.generate(orgId, user.userId, dto);
  }

  @Patch('impact/reports/:reportId/blocks/:blockId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  updateReportBlock(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: UpdateReportBlockDto,
  ) {
    return this.reports.updateBlock(orgId, reportId, blockId, dto.body);
  }

  @Get('impact/reports/:reportId/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The report as a file to attach or upload' })
  async exportReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, html } = await this.reports.exportDocument(orgId, reportId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The filename is set here rather than by the browser, so a co-op ends up
    // with "sunrise-2026-impact-report.html" in its downloads folder rather
    // than a uuid it will never identify again.
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return html;
  }

  @Post('impact/reports/:reportId/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  publishReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.reports.publish(orgId, reportId);
  }

  @Post('impact/reports/:reportId/compose')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Have the written report’s prose written again' })
  composeReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.reports.requestCompose(orgId, reportId);
  }

  // ─── Paying for the written report (IMP-23) ─────────────────

  @Get('impact/reports/:reportId/purchase')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Whether this reporting period is paid for, and what it costs' })
  reportPurchaseStatus(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.reportPurchases.statusFor(orgId, reportId);
  }

  @Post('impact/reports/:reportId/purchase')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buy the written report for this reporting period' })
  buyReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: BuyReportDto,
  ) {
    return this.stripe.createImpactReportCheckout(
      orgId,
      user.userId,
      reportId,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  @Post('impact/reports/:reportId/unpublish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  unpublishReport(
    @Param('orgId') orgId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.reports.unpublish(orgId, reportId);
  }

  // ─── Goals and the measurement plan (IMP-21) ────────────────

  @Get('impact/plan')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mission, goals, indicators, and whether the plan is agreed' })
  getPlan(@Param('orgId') orgId: string) {
    return this.goals.getPlan(orgId);
  }

  @Patch('impact/plan/mission')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Write the co-op’s mission' })
  setMission(@Param('orgId') orgId: string, @Body() dto: SetMissionDto) {
    return this.goals.setMission(orgId, dto.mission);
  }

  @Post('impact/goals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a goal, with suggested ways to measure it' })
  createGoal(@Param('orgId') orgId: string, @Body() dto: CreateGoalDto) {
    return this.goals.createGoal(orgId, dto);
  }

  @Patch('impact/goals/:goalId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  updateGoal(
    @Param('orgId') orgId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goals.updateGoal(orgId, goalId, dto);
  }

  /** Archived, never deleted — a goal a co-op pursued is part of its record. */
  @Delete('impact/goals/:goalId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  archiveGoal(
    @Param('orgId') orgId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
  ) {
    return this.goals.archiveGoal(orgId, goalId);
  }

  @Post('impact/goals/:goalId/indicators')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  addIndicator(
    @Param('orgId') orgId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: AddIndicatorDto,
  ) {
    return this.goals.addIndicator(orgId, goalId, dto);
  }

  @Delete('impact/goals/:goalId/indicators/:indicatorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  removeIndicator(
    @Param('orgId') orgId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('indicatorId', ParseUUIDPipe) indicatorId: string,
  ) {
    return this.goals.removeIndicator(orgId, goalId, indicatorId);
  }

  @Post('impact/plan/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Agree to the plan as it now stands' })
  approvePlan(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.goals.approve(orgId, user.userId);
  }

  /** The figures, arranged under the goals they were collected for. */
  @Get('impact/signals/by-goal')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  signalsByGoal(@Param('orgId') orgId: string) {
    return this.impactService.getSignalsByGoal(orgId);
  }

  // ─── Signals (IMP-20) ───────────────────────────────────────

  /**
   * What the co-op learned. Organisers only, and suppressed either way.
   */
  @Get('impact/signals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Category scores and collection windows, small cells suppressed' })
  signals(@Param('orgId') orgId: string) {
    return this.impactService.getSignals(orgId);
  }

  /**
   * What this member gave, and what their co-op learned from everyone.
   *
   * Scoped to the caller — there is no userId in the path, so this route
   * cannot be pointed at somebody else's answers however it is called. That
   * is the same shape the demographics routes use and for the same reason:
   * §10 says individual responses are never exposed, and an admin reading one
   * member's answers through a member-facing route would be exactly that.
   */
  @Get('me/impact')
  @UseGuards(JwtAuthGuard, OrgMembershipGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'A member’s own answers, and the co-op’s totals' })
  myImpact(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.impactService.myImpact(orgId, user.userId);
  }

  // ─── Measurement (IMP-18) ───────────────────────────────────

  /**
   * What this co-op is asking, and whether it is asking it.
   *
   * Readable before anything is installed, because the decision an organiser
   * is making is "shall we put these questions to our members" and they
   * cannot make it without seeing the questions.
   */
  @Get('impact/measurement')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The starter instrument and whether it is collecting' })
  measurementStatus(@Param('orgId') orgId: string) {
    return this.impactService.measurementStatus(orgId);
  }

  @Post('impact/measurement/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Install the starter instrument and open a collection window' })
  startMeasuring(@Param('orgId') orgId: string) {
    return this.impactService.startMeasuring(orgId);
  }

  @Post('impact/measurement/stop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop asking, keeping every answer already given' })
  stopMeasuring(@Param('orgId') orgId: string) {
    return this.impactService.stopMeasuring(orgId);
  }

  @Get('impact/ask')
  async nextAsk(
    @Param('orgId') orgId: string,
    @Query('touchpoint') touchpoint: Touchpoint,
    @CurrentUser() user: RequestUser,
  ) {
    // Wrapped rather than returned bare. A bare `null` leaves Nest sending a
    // 200 with an empty body, which `response.json()` throws on — so "no
    // question" and "the request failed" would arrive at the client as the
    // same thing, and the common case is no question.
    return { question: await this.touchpoints.nextAskFor(orgId, user.userId, touchpoint) };
  }

  @Post('impact/ask/:questionId/answer')
  answerAsk(
    @Param('orgId') orgId: string,
    @Param('questionId') questionId: string,
    @Body() dto: TouchpointAnswerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.touchpoints.recordAnswer(orgId, user.userId, questionId, dto.value);
  }

  /**
   * Closed without answering. Recorded rather than ignored: dismissal widens
   * this member's window, and three move them to an annual check-in only.
   */
  @Post('impact/ask/dismiss')
  dismissAsk(@Param('orgId') orgId: string, @CurrentUser() user: RequestUser) {
    return this.touchpoints.dismiss(orgId, user.userId);
  }

  // ─── Expenses (IMP-16) ──────────────────────────────────────

  /**
   * A co-op's own spending, which is why every route here is organiser-only.
   * Members can see aggregate impact; what the co-op spends is not theirs to
   * read, and there is no member-facing surface for it anywhere.
   */
  @Get('impact/expenses')
  @Roles('ADMIN', 'STAFF')
  listExpenses(
    @Param('orgId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.list(orgId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  /** Spend broken down — the denominator, not a cost-per-outcome. */
  @Get('impact/expenses/summary')
  @Roles('ADMIN', 'STAFF')
  expenseSummary(
    @Param('orgId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.summary(orgId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Post('impact/expenses')
  @Roles('ADMIN')
  createExpense(
    @Param('orgId') orgId: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.expenses.create(orgId, user.userId, dto);
  }

  @Patch('impact/expenses/:expenseId')
  @Roles('ADMIN')
  updateExpense(
    @Param('orgId') orgId: string,
    @Param('expenseId') expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expenses.update(orgId, expenseId, dto);
  }

  @Delete('impact/expenses/:expenseId')
  @Roles('ADMIN')
  deleteExpense(@Param('orgId') orgId: string, @Param('expenseId') expenseId: string) {
    return this.expenses.remove(orgId, expenseId);
  }
}
