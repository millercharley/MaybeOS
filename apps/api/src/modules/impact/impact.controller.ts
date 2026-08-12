import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ImpactService } from './impact.service';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { OpenWindowDto } from './dto/open-window.dto';

@ApiTags('impact')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class ImpactController {
  constructor(private readonly impactService: ImpactService) {}

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
      dto.demographics,
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
}
