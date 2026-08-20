import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Touchpoint } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { canAsk, afterAnswer, afterDismissal, nextAskAllowedAt } from './ask-budget';

/**
 * Asking one question at a moment the member is already in (IMP-15, PRD §6.2).
 *
 * The PRD attaches questions to moments that already exist in MaybeOS rather
 * than sending people to a survey: a ticket purchase, a booking, a finished
 * event, a Commons visit. Ticket purchase was P0 and impossible until EVT-06
 * shipped ticketing — `Event` had no price field, so the touchpoint had no
 * moment to attach to.
 *
 * Two rules do the real work here:
 *
 *  - **The fatigue budget** (D-021), enforced in `ask-budget.ts`. One question
 *    per member per 30 days across *all* touchpoints, so a member who answered
 *    at a ticket purchase is not asked again at their next booking.
 *  - **One response per member per collection window**, which the schema
 *    already enforces. A touchpoint therefore adds an *answer* to that
 *    member's existing response for the window rather than starting a new one
 *    — which is what keeps G5 true, since every answer still traces to a
 *    response count and a window.
 */
@Injectable()
export class TouchpointService {
  private readonly logger = new Logger(TouchpointService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The question to ask this member here, or null.
   *
   * Null is the common and correct answer: most of the time a member is inside
   * their window and must not be asked anything. The caller renders nothing.
   */
  async nextAskFor(orgId: string, userId: string, touchpoint: Touchpoint) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { lastAskedAt: true, askDismissals: true },
    });
    if (!membership) return null;

    if (!canAsk(membership)) {
      return null;
    }

    // Published surveys only, and questions actually attached to this moment.
    const questions = await this.prisma.surveyQuestion.findMany({
      where: {
        touchpoint,
        retiredAt: null,
        survey: { orgId, isActive: true, publishedAt: { not: null } },
      },
      orderBy: { sortOrder: 'asc' },
      include: { survey: { select: { id: true } } },
    });
    if (questions.length === 0) return null;

    // Skip anything this member has already answered in the open window: the
    // budget stops them being asked often, this stops them being asked twice.
    const answered = await this.prisma.surveyAnswer.findMany({
      where: {
        questionId: { in: questions.map((q) => q.id) },
        response: { userId, window: { closesAt: null } },
      },
      select: { questionId: true },
    });
    const seen = new Set(answered.map((a) => a.questionId));

    const question = questions.find((q) => !seen.has(q.id));
    if (!question) return null;

    return {
      id: question.id,
      surveyId: question.surveyId,
      text: question.text,
      type: question.type,
      options: question.options,
      // The two ends of the scale in the member's own language. Without them
      // a 1–5 is five unlabelled buttons, and the answers only mean the same
      // thing across members if everybody read the ends the same way.
      anchorLow: question.anchorLow,
      anchorHigh: question.anchorHigh,
      category: question.category,
    };
  }

  /**
   * Record an answer given at a touchpoint, and spend the member's budget.
   *
   * The response is upserted per collection window rather than created, since
   * a member answers at most one question per ask and will meet several over a
   * year — all of which belong to the same response for that window.
   */
  async recordAnswer(
    orgId: string,
    userId: string,
    questionId: string,
    value: string | number,
  ) {
    const question = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, survey: { orgId } },
      include: { survey: { select: { id: true } } },
    });
    if (!question) throw new NotFoundException('Question not found');

    const window = await this.prisma.collectionWindow.findFirst({
      where: { surveyId: question.surveyId, closesAt: null },
      orderBy: { opensAt: 'desc' },
    });
    if (!window) {
      throw new BadRequestException('This survey has no open collection window');
    }

    const response = await this.prisma.surveyResponse.upsert({
      where: { windowId_userId: { windowId: window.id, userId } },
      create: { surveyId: question.surveyId, windowId: window.id, userId },
      update: {},
    });

    const typed = this.valueFor(question.type, value);

    await this.prisma.surveyAnswer.upsert({
      where: { responseId_questionId: { responseId: response.id, questionId } },
      create: { responseId: response.id, questionId, category: question.category, ...typed },
      update: typed,
    });

    await this.spendBudget(orgId, userId, 'answered');
    return { recorded: true };
  }

  /**
   * The member closed the question without answering.
   *
   * Recorded rather than ignored: D-021 makes dismissal widen that member's
   * window, and three of them move them to an annual check-in. Treating a
   * dismissal as "nothing happened" would ask them again next week, which is
   * answering "no" by repeating the question.
   */
  async dismiss(orgId: string, userId: string) {
    await this.spendBudget(orgId, userId, 'dismissed');
    return { dismissed: true };
  }

  /** When this member may next be asked — for admin-facing diagnostics only. */
  async nextAllowedAt(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { lastAskedAt: true, askDismissals: true },
    });
    return membership ? nextAskAllowedAt(membership) : null;
  }

  private async spendBudget(orgId: string, userId: string, outcome: 'answered' | 'dismissed') {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { lastAskedAt: true, askDismissals: true },
    });
    if (!membership) return;

    const next = outcome === 'answered' ? afterAnswer(membership) : afterDismissal(membership);

    await this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: { lastAskedAt: next.lastAskedAt, askDismissals: next.askDismissals },
    });
  }

  private valueFor(type: string, value: string | number) {
    switch (type) {
      case 'SCALE':
      case 'NUMBER':
        return { numericValue: Number(value) };
      case 'CHOICE':
        return { choiceValue: String(value) };
      default:
        return { textValue: String(value) };
    }
  }
}
