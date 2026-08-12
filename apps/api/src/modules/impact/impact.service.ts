import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateSurveyDto } from './dto/create-survey.dto';

@Injectable()
export class ImpactService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Surveys CRUD ───────────────────────────────────────────

  async createSurvey(orgId: string, dto: CreateSurveyDto) {
    return this.prisma.survey.create({
      data: {
        orgId,
        title: dto.title,
        description: dto.description,
        type: dto.type ?? 'CUSTOM',
        questions: dto.questions as any,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
      },
    });
  }

  /**
   * Load a survey and confirm it belongs to the org in the URL.
   *
   * Every method that took a bare `surveyId` resolved it globally, while the
   * org guard only proved the caller belonged to the org they named in the
   * path. An admin of one co-op could therefore read, retitle and publish
   * another co-op's survey by pairing their own org id with its survey id —
   * verified against the dev API on 2026-08-11 (IMP-01). Same family as D-009
   * and the booking-cancel hole in SpaceOS.
   *
   * A survey in another org raises NotFound rather than Forbidden, so the
   * response cannot be used to confirm that a given survey id exists.
   */
  private async findSurveyInOrg(orgId: string, surveyId: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, orgId },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    return survey;
  }

  async updateSurvey(orgId: string, surveyId: string, dto: Partial<CreateSurveyDto>) {
    await this.findSurveyInOrg(orgId, surveyId);

    return this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.questions !== undefined && { questions: dto.questions as any }),
        ...(dto.closesAt !== undefined && { closesAt: new Date(dto.closesAt) }),
      },
    });
  }

  async publishSurvey(orgId: string, surveyId: string) {
    await this.findSurveyInOrg(orgId, surveyId);

    return this.prisma.survey.update({
      where: { id: surveyId },
      data: { isActive: true, publishedAt: new Date() },
    });
  }

  async closeSurvey(orgId: string, surveyId: string) {
    await this.findSurveyInOrg(orgId, surveyId);

    return this.prisma.survey.update({
      where: { id: surveyId },
      data: { isActive: false },
    });
  }

  async listSurveys(orgId: string) {
    return this.prisma.survey.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { responses: true } } },
    });
  }

  async getSurvey(orgId: string, surveyId: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, orgId },
      include: { _count: { select: { responses: true } } },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    return survey;
  }

  // ─── Responses ──────────────────────────────────────────────

  async submitResponse(
    orgId: string,
    surveyId: string,
    userId: string,
    answers: Record<string, any>,
    demographics?: Record<string, any>,
  ) {
    await this.findSurveyInOrg(orgId, surveyId);

    return this.prisma.surveyResponse.create({
      data: {
        surveyId,
        userId,
        answers: answers as any,
        demographics: demographics as any,
      },
    });
  }

  // getResponses() and exportResponses() were removed here — see the note in
  // impact.controller.ts. Both returned individual answers joined to the
  // respondent's name and email; D-021 puts individual responses out of an
  // admin's reach entirely.

  // ─── Dashboard / Aggregate Metrics ──────────────────────────

  async getDashboard(orgId: string) {
    // Total responses per survey
    const surveys = await this.prisma.survey.findMany({
      where: { orgId },
      include: { _count: { select: { responses: true } } },
    });

    const totalResponsesPerSurvey = surveys.map((s) => ({
      surveyId: s.id,
      title: s.title,
      type: s.type,
      totalResponses: s._count.responses,
    }));

    // Average scores by category
    const allResponses = await this.prisma.surveyResponse.findMany({
      where: { survey: { orgId } },
      select: { answers: true, createdAt: true },
    });

    const categories = [
      'belonging',
      'loneliness',
      'network_size',
      'participation',
      'civic_engagement',
    ];

    const averageScores: Record<string, number | null> = {};
    for (const category of categories) {
      const values: number[] = [];
      for (const response of allResponses) {
        const answers = response.answers as Record<string, any>;
        if (answers[category] !== undefined && typeof answers[category] === 'number') {
          values.push(answers[category]);
        }
      }
      averageScores[category] =
        values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    }

    // Trends over time (group by month)
    const trendsMap: Record<string, { count: number; scores: Record<string, number[]> }> = {};
    for (const response of allResponses) {
      const monthKey = response.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!trendsMap[monthKey]) {
        trendsMap[monthKey] = { count: 0, scores: {} };
        for (const cat of categories) {
          trendsMap[monthKey].scores[cat] = [];
        }
      }
      trendsMap[monthKey].count++;

      const answers = response.answers as Record<string, any>;
      for (const cat of categories) {
        if (answers[cat] !== undefined && typeof answers[cat] === 'number') {
          trendsMap[monthKey].scores[cat].push(answers[cat]);
        }
      }
    }

    const trends = Object.entries(trendsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const avgScores: Record<string, number | null> = {};
        for (const cat of categories) {
          const vals = data.scores[cat];
          avgScores[cat] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        }
        return { month, responseCount: data.count, averageScores: avgScores };
      });

    // Retention metrics (member count by join month)
    const members = await this.prisma.userOrg.findMany({
      where: { orgId },
      select: { memberSince: true },
    });

    const retentionMap: Record<string, number> = {};
    for (const m of members) {
      const monthKey = m.memberSince.toISOString().slice(0, 7);
      retentionMap[monthKey] = (retentionMap[monthKey] || 0) + 1;
    }

    const retention = Object.entries(retentionMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, memberCount: count }));

    // Attendance stats (avg attendance per event)
    const events = await this.prisma.event.findMany({
      where: { orgId },
      select: { id: true, title: true, _count: { select: { attendance: true } } },
    });

    const attendanceCounts = events.map((e) => e._count.attendance);
    const avgAttendance =
      attendanceCounts.length > 0
        ? attendanceCounts.reduce((a, b) => a + b, 0) / attendanceCounts.length
        : 0;

    return {
      totalResponsesPerSurvey,
      averageScores,
      trends,
      retention,
      attendanceStats: {
        totalEvents: events.length,
        averageAttendancePerEvent: Math.round(avgAttendance * 100) / 100,
      },
    };
  }
}
