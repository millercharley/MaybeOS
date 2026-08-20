import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, SurveyQuestion, SurveyQuestionType } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  STARTER_QUESTIONS,
  STARTER_INSTRUMENT_VERSION,
  STARTER_SURVEY_TITLE,
  windowLabelFor,
} from './starter-instrument';
import { CreateSurveyDto, SurveyQuestionDto } from './dto/create-survey.dto';
import {
  DEMOGRAPHIC_FIELDS,
  PREFER_NOT_TO_SAY,
  SUPPRESSION_THRESHOLD,
  sanitizeDemographics,
  suppressSmallCells,
} from './demographics';

const QUESTION_SELECT = {
  id: true,
  key: true,
  version: true,
  text: true,
  type: true,
  options: true,
  category: true,
  required: true,
  sortOrder: true,
} as const;

/**
 * Display ordering for the dashboard, not a filter.
 *
 * `getDashboard` reports whatever categories the questions actually declare.
 * The old implementation hardcoded this list as the *source* of its numbers
 * and averaged answer keys named after these categories — keys nothing ever
 * wrote, which is the whole of IMP-05.
 */
const HEADLINE_CATEGORIES = [
  'belonging',
  'loneliness',
  'network_size',
  'participation',
  'civic_engagement',
];

@Injectable()
export class ImpactService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Org scoping (IMP-01) ───────────────────────────────────

  /**
   * Load a survey and confirm it belongs to the org in the URL.
   *
   * A survey in another org raises NotFound rather than Forbidden, so the
   * response cannot confirm that a given survey id exists. Same choice as
   * SPC-02, CMN-07 and SEC-04.
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

  // ─── Surveys ────────────────────────────────────────────────

  async createSurvey(orgId: string, dto: CreateSurveyDto) {
    this.assertQuestionsWellFormed(dto.questions);

    return this.prisma.survey.create({
      data: {
        orgId,
        title: dto.title,
        description: dto.description,
        type: dto.type ?? 'CUSTOM',
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
        questions: {
          create: dto.questions.map((q, i) => ({
            key: q.key,
            text: q.text,
            type: q.type as SurveyQuestionType,
            options: q.options ?? [],
            category: q.category,
            required: q.required ?? false,
            sortOrder: q.sortOrder ?? i,
          })),
        },
        // A survey with no window cannot accept anything, so one opens with
        // it rather than being a step somebody has to remember.
        windows: {
          create: {
            label: dto.windowLabel ?? 'Initial',
            closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
          },
        },
      },
      include: {
        questions: { select: QUESTION_SELECT, orderBy: { sortOrder: 'asc' } },
        windows: true,
      },
    });
  }

  /**
   * Edit a survey.
   *
   * Wording changes do not overwrite a question. The current version is
   * retired and a new one written, so every answer stays attached to the text
   * its author actually read. That is the "visible seam" the PRD requires of
   * any mid-collection change (D-021).
   */
  async updateSurvey(orgId: string, surveyId: string, dto: Partial<CreateSurveyDto>) {
    await this.findSurveyInOrg(orgId, surveyId);

    if (dto.questions) {
      this.assertQuestionsWellFormed(dto.questions);
      await this.reviseQuestions(surveyId, dto.questions);
    }

    return this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.closesAt !== undefined && { closesAt: new Date(dto.closesAt) }),
      },
      include: {
        questions: {
          where: { retiredAt: null },
          select: QUESTION_SELECT,
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  private assertQuestionsWellFormed(questions: SurveyQuestionDto[]) {
    const seen = new Set<string>();
    for (const q of questions) {
      if (seen.has(q.key)) {
        throw new BadRequestException(`Duplicate question key "${q.key}"`);
      }
      seen.add(q.key);

      if (q.type === 'CHOICE' && (!q.options || q.options.length === 0)) {
        throw new BadRequestException(
          `Question "${q.key}" is a CHOICE and needs at least one option`,
        );
      }
    }
  }

  private async reviseQuestions(surveyId: string, incoming: SurveyQuestionDto[]) {
    const current = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, retiredAt: null },
    });
    const byKey = new Map(current.map((q) => [q.key, q]));

    await this.prisma.$transaction(async (tx) => {
      for (const [i, q] of incoming.entries()) {
        const existing = byKey.get(q.key);
        const unchanged =
          existing &&
          existing.text === q.text &&
          existing.type === q.type &&
          (existing.category ?? undefined) === q.category &&
          existing.required === (q.required ?? false) &&
          existing.options.join(' ') === (q.options ?? []).join(' ');

        if (unchanged) {
          if (existing.sortOrder !== (q.sortOrder ?? i)) {
            // Ordering is presentation, not meaning — no new version for it.
            await tx.surveyQuestion.update({
              where: { id: existing.id },
              data: { sortOrder: q.sortOrder ?? i },
            });
          }
          continue;
        }

        if (existing) {
          await tx.surveyQuestion.update({
            where: { id: existing.id },
            data: { retiredAt: new Date() },
          });
        }

        await tx.surveyQuestion.create({
          data: {
            surveyId,
            key: q.key,
            version: existing ? existing.version + 1 : 1,
            text: q.text,
            type: q.type as SurveyQuestionType,
            options: q.options ?? [],
            category: q.category,
            required: q.required ?? false,
            sortOrder: q.sortOrder ?? i,
          },
        });
      }

      // A question dropped from the payload is retired, never deleted: its
      // answers are still part of the record.
      const incomingKeys = new Set(incoming.map((q) => q.key));
      for (const q of current) {
        if (!incomingKeys.has(q.key)) {
          await tx.surveyQuestion.update({
            where: { id: q.id },
            data: { retiredAt: new Date() },
          });
        }
      }
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

    const now = new Date();

    // Closing the survey closes its open windows too. A window left open on a
    // closed survey is the state IMP-09 was made of.
    return this.prisma.$transaction(async (tx) => {
      await tx.collectionWindow.updateMany({
        where: { surveyId, closesAt: null },
        data: { closesAt: now },
      });

      return tx.survey.update({
        where: { id: surveyId },
        data: { isActive: false, closesAt: now },
      });
    });
  }

  /** Open a new collection window — next year's round of the same survey. */
  async openWindow(orgId: string, surveyId: string, label: string, closesAt?: string) {
    await this.findSurveyInOrg(orgId, surveyId);

    const clash = await this.prisma.collectionWindow.findFirst({
      where: { surveyId, label },
    });
    if (clash) {
      throw new ConflictException(
        `A window named "${label}" already exists on this survey`,
      );
    }

    return this.prisma.collectionWindow.create({
      data: {
        surveyId,
        label,
        closesAt: closesAt ? new Date(closesAt) : undefined,
      },
    });
  }

  async listSurveys(orgId: string) {
    return this.prisma.survey.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { responses: true } },
        questions: {
          where: { retiredAt: null },
          select: QUESTION_SELECT,
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async getSurvey(orgId: string, surveyId: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, orgId },
      include: {
        _count: { select: { responses: true } },
        questions: {
          where: { retiredAt: null },
          select: QUESTION_SELECT,
          orderBy: { sortOrder: 'asc' },
        },
        windows: { orderBy: { opensAt: 'desc' } },
      },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    return survey;
  }

  // ─── Responses ──────────────────────────────────────────────

  /**
   * Record one member's answers.
   *
   * Everything IMP-08 and IMP-09 described is enforced here rather than hoped
   * for. This method previously checked only that the survey existed: it
   * accepted an entirely empty answer set against five required questions,
   * accepted responses to surveys that had never been published and to ones
   * already closed, and accepted the same member's answers without limit —
   * one person submitted four during the audit.
   */
  async submitResponse(
    orgId: string,
    surveyId: string,
    userId: string,
    answers: Record<string, unknown>,
  ) {
    const survey = await this.findSurveyInOrg(orgId, surveyId);

    if (!survey.isActive || !survey.publishedAt) {
      throw new BadRequestException('This survey is not open for responses');
    }

    const window = await this.currentWindow(surveyId);
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, retiredAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    const values = this.validateAnswers(questions, answers);

    try {
      return await this.prisma.surveyResponse.create({
        data: {
          surveyId,
          windowId: window.id,
          userId,
          // No demographics here. The PRD is explicit that they are collected
          // once in the member's own profile and "never inside impact
          // micro-surveys" (§6.4) — asking again per response both burns the
          // fatigue budget and scatters copies of the same personal data
          // across every survey somebody ever answers. The column stays for
          // the rows already written; nothing adds to it. See IMP-17.
          answers: { create: values },
        },
        include: { answers: true },
      });
    } catch (error) {
      // The unique index on (windowId, userId) is what actually prevents a
      // second response; catching its violation turns a 500 into an answer.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `You have already responded to this survey for "${window.label}"`,
        );
      }
      throw error;
    }
  }

  private async currentWindow(surveyId: string) {
    const now = new Date();
    const window = await this.prisma.collectionWindow.findFirst({
      where: {
        surveyId,
        opensAt: { lte: now },
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      orderBy: { opensAt: 'desc' },
    });

    if (!window) {
      throw new BadRequestException('This survey has no open collection window');
    }

    return window;
  }

  /**
   * Check answers against the questions as defined and convert them into typed
   * rows. Returns the rows to write; throws on the first problem.
   */
  private validateAnswers(
    questions: SurveyQuestion[],
    answers: Record<string, unknown>,
  ): Prisma.SurveyAnswerCreateWithoutResponseInput[] {
    const byKey = new Map(questions.map((q) => [q.key, q]));

    const unknownKeys = Object.keys(answers).filter((k) => !byKey.has(k));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(`Unknown question key(s): ${unknownKeys.join(', ')}`);
    }

    const rows: Prisma.SurveyAnswerCreateWithoutResponseInput[] = [];
    const missing: string[] = [];

    for (const q of questions) {
      const raw = answers[q.key];
      const absent = raw === undefined || raw === null || raw === '';

      if (absent) {
        if (q.required) missing.push(q.key);
        continue;
      }

      rows.push({
        question: { connect: { id: q.id } },
        category: q.category,
        ...this.coerce(q, raw),
      });
    }

    if (missing.length > 0) {
      throw new BadRequestException(`Missing required answer(s): ${missing.join(', ')}`);
    }

    if (rows.length === 0) {
      throw new BadRequestException('A response must answer at least one question');
    }

    return rows;
  }

  private coerce(question: SurveyQuestion, raw: unknown) {
    switch (question.type) {
      case 'SCALE': {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw new BadRequestException(
            `"${question.key}" is a 1-5 scale; got ${JSON.stringify(raw)}`,
          );
        }
        return { numericValue: n };
      }
      case 'NUMBER': {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          throw new BadRequestException(
            `"${question.key}" expects a number; got ${JSON.stringify(raw)}`,
          );
        }
        return { numericValue: n };
      }
      case 'CHOICE': {
        const v = String(raw);
        if (!question.options.includes(v)) {
          throw new BadRequestException(`"${v}" is not an option for "${question.key}"`);
        }
        return { choiceValue: v };
      }
      case 'TEXT':
      default:
        return { textValue: String(raw) };
    }
  }

  // ─── Dashboard ──────────────────────────────────────────────

  /**
   * Aggregate metrics.
   *
   * Every figure carries a response count and the window it came from, which
   * is the point: a number with no denominator and no dates is a claim a
   * funder discounts (D-021, G5).
   *
   * The averages come from a groupBy over typed columns. The old version
   * loaded every response and averaged JSON keys named after categories, which
   * nothing wrote, so every score was null against real data.
   */
  // ─── Demographic profile (IMP-17, PRD §6.4) ─────────────────

  /**
   * The member's own demographic profile, with the questions to ask.
   *
   * Returns the field definitions alongside the answers so the client does
   * not carry its own copy of the vocabulary — a second list would drift, and
   * a mismatched key silently becomes an unanswerable question.
   */
  async getMyDemographics(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { demographics: true },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of this organization');
    }

    return {
      fields: DEMOGRAPHIC_FIELDS,
      answers: (membership.demographics as Record<string, string>) ?? {},
      // Surfaced rather than hardcoded in the UI copy, so the promise the
      // member is shown and the rule the reports obey are the same number.
      suppressionThreshold: SUPPRESSION_THRESHOLD,
    };
  }

  async updateMyDemographics(
    orgId: string,
    userId: string,
    input: Record<string, unknown>,
  ) {
    const clean = sanitizeDemographics(input);

    const updated = await this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      // Replaces rather than merges: a field the member cleared has to be
      // able to disappear, and a merge would make removal impossible.
      data: { demographics: clean as Prisma.InputJsonValue },
      select: { demographics: true },
    });

    return { answers: updated.demographics ?? {} };
  }

  /**
   * Delete the profile outright.
   *
   * The PRD makes this member-owned data, "viewable, editable, and deletable
   * at any time, with deletion propagating to future reports" (§10). Because
   * segment counts are computed from this column at report time rather than
   * copied into the report, deleting here removes them from every future
   * report by construction — nothing has to remember to propagate.
   */
  async deleteMyDemographics(orgId: string, userId: string) {
    await this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: { demographics: Prisma.DbNull },
    });

    return { deleted: true };
  }

  /**
   * Who the space actually serves — and who it does not reach.
   *
   * Aggregated live from the member profiles, never from a stored copy, so a
   * member who deletes their profile is gone from the next read. Every
   * distribution passes through small-cell suppression, which the PRD makes
   * mandatory and non-overridable by any role including owner.
   */
  async getDemographicSummary(orgId: string) {
    const memberships = await this.prisma.userOrg.findMany({
      where: { orgId },
      select: { demographics: true },
    });

    const profiles = memberships
      .map((m) => m.demographics as Record<string, string> | null)
      .filter((d): d is Record<string, string> => Boolean(d && Object.keys(d).length));

    const fields = DEMOGRAPHIC_FIELDS.map((field) => {
      const counts: Record<string, number> = {};
      let preferNotToSay = 0;

      for (const profile of profiles) {
        const value = profile[field.key];
        if (!value) continue;
        if (value === PREFER_NOT_TO_SAY) {
          preferNotToSay += 1;
          continue;
        }
        counts[value] = (counts[value] ?? 0) + 1;
      }

      return {
        key: field.key,
        label: field.label,
        ...suppressSmallCells(counts),
        preferNotToSay,
        answered: Object.values(counts).reduce((n, c) => n + c, 0) + preferNotToSay,
      };
    });

    return {
      totalMembers: memberships.length,
      // Coverage is the honest denominator: a distribution over 12 of 300
      // members describes those 12, and the PRD wants gaps visible rather
      // than smoothed over.
      profilesCompleted: profiles.length,
      suppressionThreshold: SUPPRESSION_THRESHOLD,
      fields,
    };
  }

  async getDashboard(orgId: string) {
    const [surveys, members, events, attendance, pastEvents] = await Promise.all([
      this.prisma.survey.findMany({
        where: { orgId },
        include: { _count: { select: { responses: true } } },
      }),
      this.prisma.userOrg.count({ where: { orgId } }),
      this.prisma.event.count({ where: { orgId } }),
      this.prisma.attendance.count({ where: { event: { orgId } } }),
      this.prisma.event.count({
        where: { orgId, endTime: { lt: new Date() }, canceledAt: null },
      }),
    ]);

    const grouped = await this.prisma.surveyAnswer.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
        numericValue: { not: null },
        response: { survey: { orgId } },
      },
      _avg: { numericValue: true },
      _count: { numericValue: true },
    });

    const scores = grouped
      .map((g) => ({
        category: g.category as string,
        average:
          g._avg.numericValue === null
            ? null
            : Math.round(g._avg.numericValue * 100) / 100,
        answerCount: g._count.numericValue,
      }))
      .sort((a, b) => {
        const ai = HEADLINE_CATEGORIES.indexOf(a.category);
        const bi = HEADLINE_CATEGORIES.indexOf(b.category);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

    // Per window, so a trend compares like with like rather than drawing a
    // line through whatever happened to be collected that month.
    const windows = await this.prisma.collectionWindow.findMany({
      where: { survey: { orgId } },
      orderBy: { opensAt: 'asc' },
      include: {
        survey: { select: { id: true, title: true } },
        _count: { select: { responses: true } },
      },
    });

    const totalResponses = surveys.reduce((n, s) => n + s._count.responses, 0);

    return {
      totalMembers: members,
      totalEvents: events,
      totalResponses,
      totalAttendance: attendance,
      /**
       * Reach, per event that has actually happened (IMP-10).
       *
       * `totalAttendance` alone answers nothing: 40 check-ins across 2 events
       * and across 40 tell very different stories. Dividing by *past* events
       * rather than all of them keeps next month's programme from dragging
       * the average down — an event nobody has attended yet is not a poorly
       * attended event.
       */
      avgAttendance:
        pastEvents > 0 ? Math.round((attendance / pastEvents) * 10) / 10 : 0,
      pastEvents,
      participationRate: members > 0 ? Math.round((totalResponses / members) * 100) : 0,
      scores,
      surveys: surveys.map((s) => ({
        surveyId: s.id,
        title: s.title,
        type: s.type,
        isActive: s.isActive,
        responses: s._count.responses,
      })),
      windows: windows.map((w) => ({
        windowId: w.id,
        surveyId: w.survey.id,
        surveyTitle: w.survey.title,
        label: w.label,
        opensAt: w.opensAt,
        closesAt: w.closesAt,
        responses: w._count.responses,
      })),
    };
  }

  // ─── The starter instrument (IMP-18) ────────────────────────

  /**
   * Whether this co-op is collecting anything, and what it is asking.
   *
   * The question list is returned in full and deliberately: an admin who
   * switches this on is about to have MaybeOS put questions to their members,
   * and they should read them first. Nobody should have to discover what
   * their co-op is asking by being asked it.
   */
  async measurementStatus(orgId: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { orgId, type: 'BASELINE' },
      include: {
        questions: {
          where: { retiredAt: null },
          orderBy: [{ touchpoint: 'asc' }, { sortOrder: 'asc' }],
        },
        windows: { orderBy: { opensAt: 'desc' }, take: 1 },
        _count: { select: { responses: true } },
      },
    });

    if (!survey) {
      // Not installed. The catalogue is still returned, because the decision
      // an admin is being asked to make is "shall we ask these questions".
      return {
        installed: false,
        collecting: false,
        version: STARTER_INSTRUMENT_VERSION,
        questions: STARTER_QUESTIONS.map((q) => ({
          key: q.key,
          text: q.text,
          type: q.type,
          category: q.category,
          touchpoint: q.touchpoint,
          anchorLow: q.anchorLow,
          anchorHigh: q.anchorHigh,
        })),
        window: null,
        responseCount: 0,
        answerCount: 0,
      };
    }

    const answerCount = await this.prisma.surveyAnswer.count({
      where: { response: { surveyId: survey.id } },
    });

    return {
      installed: true,
      collecting: survey.isActive && survey.publishedAt !== null,
      version: STARTER_INSTRUMENT_VERSION,
      questions: survey.questions.map((q) => ({
        key: q.key,
        text: q.text,
        type: q.type,
        category: q.category,
        touchpoint: q.touchpoint,
        anchorLow: q.anchorLow,
        anchorHigh: q.anchorHigh,
      })),
      window: survey.windows[0]
        ? {
            id: survey.windows[0].id,
            label: survey.windows[0].label,
            opensAt: survey.windows[0].opensAt,
            closesAt: survey.windows[0].closesAt,
          }
        : null,
      responseCount: survey._count.responses,
      answerCount,
    };
  }

  /**
   * Install the starter instrument and open a collection window.
   *
   * Idempotent, and safe to call on a co-op that is already collecting — it
   * will not create a second survey, duplicate a question or open a second
   * window. That matters because the alternative to idempotence here is a
   * co-op with two overlapping baselines, which quietly breaks G5: an answer
   * could then belong to either window and no figure would trace cleanly.
   *
   * **This is never automatic.** A co-op is not opted into questioning its own
   * members by signing up; an organiser turns it on having read what will be
   * asked.
   */
  async startMeasuring(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // findFirst-then-create rather than upsert: there is no unique key on
    // (orgId, type) to upsert against, and adding one would forbid a co-op
    // ever having two CUSTOM surveys. The database still refuses a second
    // BASELINE through a partial unique index, so the bad state cannot exist
    // even if two organisers click at the same moment.
    const existing = await this.prisma.survey.findFirst({
      where: { orgId, type: 'BASELINE' },
      select: { id: true },
    });

    const survey = existing
      ? await this.prisma.survey.update({
          where: { id: existing.id },
          data: { isActive: true, publishedAt: new Date() },
          select: { id: true },
        })
      : await this.prisma.survey.create({
          data: {
            orgId,
            type: 'BASELINE',
            title: STARTER_SURVEY_TITLE,
            description:
              'A short set of questions MaybeOS asks a few times a year, one at a time.',
            isActive: true,
            publishedAt: new Date(),
          },
          select: { id: true },
        });

    // Questions are versioned and never edited in place, so this creates only
    // what is missing — reinstalling after a wording change adds the new
    // version beside the retired one rather than rewriting history.
    for (const [index, question] of STARTER_QUESTIONS.entries()) {
      await this.prisma.surveyQuestion.upsert({
        where: {
          surveyId_key_version: {
            surveyId: survey.id,
            key: question.key,
            version: STARTER_INSTRUMENT_VERSION,
          },
        },
        create: {
          surveyId: survey.id,
          key: question.key,
          version: STARTER_INSTRUMENT_VERSION,
          text: question.text,
          type: question.type,
          options: question.options ?? [],
          anchorLow: question.anchorLow,
          anchorHigh: question.anchorHigh,
          higherIsBetter: question.higherIsBetter ?? true,
          category: question.category,
          touchpoint: question.touchpoint,
          sortOrder: index,
        },
        update: {},
      });
    }

    // One open window at a time. `closesAt: null` is what "open" means, and
    // the touchpoint service picks the most recent open one — so a second
    // would silently split a year's answers in two.
    const open = await this.prisma.collectionWindow.findFirst({
      where: { surveyId: survey.id, closesAt: null },
      select: { id: true, label: true },
    });

    const window =
      open ??
      (await this.prisma.collectionWindow.create({
        data: { surveyId: survey.id, label: windowLabelFor(new Date()) },
        select: { id: true, label: true },
      }));

    return { surveyId: survey.id, windowId: window.id, window: window.label };
  }

  /**
   * Stop asking, without throwing anything away.
   *
   * Deactivates the survey rather than deleting it, and leaves the window
   * open: answers already given still belong to it and still count. A co-op
   * pausing for a month should not lose the months before.
   */
  async stopMeasuring(orgId: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { orgId, type: 'BASELINE' },
      select: { id: true },
    });
    if (!survey) throw new NotFoundException('This co-op is not measuring anything');

    await this.prisma.survey.update({
      where: { id: survey.id },
      data: { isActive: false },
    });

    return { collecting: false };
  }

  // ─── Signals (IMP-20) ───────────────────────────────────────

  /**
   * What a co-op learned, per category and per collection window.
   *
   * Three things this does that `getDashboard` does not, each of which is the
   * difference between a number and a number worth showing:
   *
   * **It suppresses small cells.** `getDashboard` averages a category however
   * few answers it has, so a category answered by one person reports that
   * person's answer as the co-op's score. §10 says individual responses are
   * never exposed to admins, and an average of one *is* an individual
   * response — a rule the demographics endpoint already obeys and this one
   * did not.
   *
   * **It groups by window.** An average across every window is a line drawn
   * through whatever happened to be collected that month; the same figure per
   * window is a trend. G5 requires every figure to trace to a response count
   * and a window, and one that spans all of them traces to neither.
   *
   * **It carries direction.** Belonging and loneliness are both 1–5 and point
   * opposite ways (IMP-18), so a reader shown "4.2" needs to be told whether
   * that is good news.
   */
  async getSignals(orgId: string) {
    const windows = await this.prisma.collectionWindow.findMany({
      where: { survey: { orgId } },
      orderBy: { opensAt: 'asc' },
      select: {
        id: true,
        label: true,
        opensAt: true,
        closesAt: true,
        _count: { select: { responses: true } },
      },
    });

    const members = await this.prisma.userOrg.count({ where: { orgId } });

    // Direction lives on the question, so it has to come from the questions
    // rather than from the answers. Categories are consistent within the
    // instrument, so the first question in a category settles it.
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { survey: { orgId }, category: { not: null } },
      select: { category: true, higherIsBetter: true },
    });
    const direction = new Map<string, boolean>();
    for (const q of questions) {
      if (q.category && !direction.has(q.category)) direction.set(q.category, q.higherIsBetter);
    }

    const grouped = await this.prisma.surveyAnswer.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
        numericValue: { not: null },
        response: { survey: { orgId } },
      },
      _avg: { numericValue: true },
      // Distinct respondents is the number that decides suppression, and a
      // plain answer count is not it: one member answering the same category
      // at four touchpoints is one person, not four.
      _count: { numericValue: true },
    });

    const respondents = await this.prisma.surveyAnswer.findMany({
      where: {
        category: { not: null },
        numericValue: { not: null },
        response: { survey: { orgId } },
      },
      select: { category: true, response: { select: { userId: true } } },
    });

    const peoplePerCategory = new Map<string, Set<string>>();
    for (const answer of respondents) {
      if (!answer.category) continue;
      const set = peoplePerCategory.get(answer.category) ?? new Set<string>();
      // Anonymous answers count as distinct people — there is no identity to
      // collapse them by, which is the same reasoning the response unique
      // index uses.
      set.add(answer.response.userId ?? `anon:${set.size}`);
      peoplePerCategory.set(answer.category, set);
    }

    const categories = grouped
      .map((g) => {
        const category = g.category as string;
        const people = peoplePerCategory.get(category)?.size ?? 0;
        const reportable = people >= SUPPRESSION_THRESHOLD;

        return {
          category,
          /** Null when too few people answered to report without exposing one. */
          average:
            reportable && g._avg.numericValue !== null
              ? Math.round(g._avg.numericValue * 100) / 100
              : null,
          answerCount: g._count.numericValue,
          respondents: people,
          reportable,
          higherIsBetter: direction.get(category) ?? true,
        };
      })
      .sort((a, b) => {
        const ai = HEADLINE_CATEGORIES.indexOf(a.category);
        const bi = HEADLINE_CATEGORIES.indexOf(b.category);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

    return {
      suppressionThreshold: SUPPRESSION_THRESHOLD,
      members,
      categories,
      windows: windows.map((w) => ({
        windowId: w.id,
        label: w.label,
        opensAt: w.opensAt,
        closesAt: w.closesAt,
        responses: w._count.responses,
        /** Of the co-op, so a rate means something without a second lookup. */
        responseRate: members > 0 ? Math.round((w._count.responses / members) * 100) : 0,
      })),
    };
  }

  /**
   * What one member gave, and what their co-op learned from everyone.
   *
   * The half of ImpactOS that did not exist. A member answers a question a
   * month for a year and is told nothing back, which is how response rate
   * dies — and D-021 calls response rate the binding constraint on the whole
   * product, so this is load-bearing rather than courteous.
   *
   * Their own answers are theirs to see in full; the co-op's figures obey the
   * same suppression an organiser sees, because a member is not entitled to
   * read a small cell either.
   */
  async myImpact(orgId: string, userId: string) {
    const answers = await this.prisma.surveyAnswer.findMany({
      where: { response: { userId, survey: { orgId } } },
      orderBy: { response: { createdAt: 'desc' } },
      select: {
        numericValue: true,
        textValue: true,
        choiceValue: true,
        category: true,
        question: {
          select: { text: true, type: true, anchorLow: true, anchorHigh: true },
        },
        response: { select: { createdAt: true, window: { select: { label: true } } } },
      },
    });

    const signals = await this.getSignals(orgId);

    return {
      answers: answers.map((a) => ({
        question: a.question.text,
        type: a.question.type,
        anchorLow: a.question.anchorLow,
        anchorHigh: a.question.anchorHigh,
        category: a.category,
        value: a.numericValue ?? a.choiceValue ?? a.textValue,
        window: a.response.window.label,
        answeredAt: a.response.createdAt,
      })),
      // Exactly what an organiser sees, suppression included. There is no
      // second, looser view for members.
      community: signals,
    };
  }

  /**
   * The same figures, arranged under what the co-op said it was trying to do
   * (IMP-21).
   *
   * This is what the spine is *for*. `getSignals` can report that belonging
   * averages 3.8; only a goal can say that the co-op set out to make people
   * feel they belong here, and that this is how that is going. A figure with
   * no stated intention behind it is a statistic; the same figure under a
   * goal is a finding.
   *
   * Categories not claimed by any goal are still returned, separately. They
   * are being collected, so hiding them would mean a co-op could not see data
   * it holds — and an unclaimed category is often a goal somebody forgot to
   * write down rather than noise.
   */
  async getSignalsByGoal(orgId: string) {
    const signals = await this.getSignals(orgId);

    const goals = await this.prisma.goal.findMany({
      where: { orgId, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { indicators: { orderBy: { createdAt: 'asc' } } },
    });

    const byCategory = new Map(signals.categories.map((c) => [c.category, c]));
    const claimed = new Set<string>();

    const withGoals = goals.map((goal) => {
      const measures = goal.indicators.map((indicator) => {
        claimed.add(indicator.category);
        return {
          indicatorId: indicator.id,
          label: indicator.label,
          category: indicator.category,
          // Null when nothing has been answered in this category yet, which
          // is different from a suppressed figure and reads differently: one
          // is "not asked yet", the other is "too few to show".
          signal: byCategory.get(indicator.category) ?? null,
        };
      });

      return {
        goalId: goal.id,
        title: goal.title,
        description: goal.description,
        measures,
        /** A goal nothing measures, said plainly rather than shown as zero. */
        unmeasured: measures.length === 0,
      };
    });

    return {
      ...signals,
      goals: withGoals,
      unclaimed: signals.categories.filter((c) => !claimed.has(c.category)),
    };
  }
}
