import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
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

  @Get('surveys/:surveyId/responses')
  @Roles('ADMIN')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  getResponses(
    @Param('surveyId') surveyId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    return this.impactService.getResponses(surveyId, page, perPage);
  }

  @Get('surveys/:surveyId/export')
  @Roles('ADMIN')
  async exportResponses(
    @Param('surveyId') surveyId: string,
    @Res() res: Response,
  ) {
    const responses = await this.impactService.exportResponses(surveyId);

    // Build CSV header and rows
    if (responses.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="survey-${surveyId}-responses.csv"`);
      return res.send('');
    }

    // Collect all unique answer keys across responses
    const answerKeys = new Set<string>();
    for (const r of responses) {
      const answers = r.answers as Record<string, any>;
      Object.keys(answers).forEach((k) => answerKeys.add(k));
    }

    const sortedKeys = Array.from(answerKeys).sort();
    const headers = ['id', 'userId', 'userName', 'userEmail', ...sortedKeys, 'createdAt'];
    const csvRows = [headers.join(',')];

    for (const r of responses) {
      const answers = r.answers as Record<string, any>;
      const row = [
        r.id,
        r.userId ?? '',
        r.user?.name ?? '',
        r.user?.email ?? '',
        ...sortedKeys.map((k) => {
          const val = answers[k];
          if (val === undefined || val === null) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }),
        r.createdAt.toISOString(),
      ];
      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="survey-${surveyId}-responses.csv"`);
    return res.send(csvRows.join('\n'));
  }

  // ─── Dashboard ──────────────────────────────────────────────

  @Get('impact/dashboard')
  @Roles('ADMIN', 'STAFF')
  getDashboard(@Param('orgId') orgId: string) {
    return this.impactService.getDashboard(orgId);
  }
}
