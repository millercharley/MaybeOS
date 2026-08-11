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

  @Get('surveys/:surveyId')
  getSurvey(@Param('surveyId') surveyId: string) {
    return this.impactService.getSurvey(surveyId);
  }

  @Patch('surveys/:surveyId')
  @Roles('ADMIN')
  updateSurvey(
    @Param('surveyId') surveyId: string,
    @Body() dto: Partial<CreateSurveyDto>,
  ) {
    return this.impactService.updateSurvey(surveyId, dto);
  }

  @Post('surveys/:surveyId/publish')
  @Roles('ADMIN')
  publishSurvey(@Param('surveyId') surveyId: string) {
    return this.impactService.publishSurvey(surveyId);
  }

  @Post('surveys/:surveyId/close')
  @Roles('ADMIN')
  closeSurvey(@Param('surveyId') surveyId: string) {
    return this.impactService.closeSurvey(surveyId);
  }

  // ─── Responses ──────────────────────────────────────────────

  @Post('surveys/:surveyId/respond')
  submitResponse(
    @Param('surveyId') surveyId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SubmitResponseDto,
  ) {
    // userId may be null for anonymous responses (token-based)
    const userId = user?.userId ?? null;
    return this.impactService.submitResponse(surveyId, userId, dto.answers, dto.demographics);
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
