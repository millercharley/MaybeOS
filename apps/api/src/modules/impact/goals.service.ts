import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { draftIndicatorsFor, allMeasurableCategories } from './goal-drafting';

/**
 * The measurement plan: a mission, a few goals, and how each is measured
 * (IMP-21, PRD §5).
 *
 * Two rules carry the design.
 *
 * **Editing returns the plan to draft.** A plan that changes after it was
 * approved is not an approved plan, and an approval that survives its own
 * contents changing is a signature on a blank page. So every write here
 * un-approves, and an organiser re-approves what the plan now says.
 *
 * **Goals are archived, never deleted.** A goal a co-op pursued for a year is
 * part of what its report says. Deleting it would silently rewrite the past,
 * and the figures collected against it would become untraceable — which is G5.
 */
@Injectable()
export class GoalsService {
  /**
   * Three to five, per the PRD, enforced rather than suggested.
   *
   * The discipline is the point: a co-op measuring nine things measures none
   * of them, and the fatigue budget means there is only ever room to ask
   * about a handful. Raising this is a product decision, not a config change.
   */
  static readonly MAX_GOALS = 5;

  constructor(private readonly prisma: PrismaService) {}

  /** The whole plan: mission, goals, indicators, and whether it is agreed. */
  async getPlan(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { mission: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const [goals, plan] = await Promise.all([
      this.prisma.goal.findMany({
        where: { orgId, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: { indicators: { orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.measurementPlan.findUnique({ where: { orgId } }),
    ]);

    return {
      mission: org.mission,
      status: plan?.status ?? 'DRAFT',
      approvedAt: plan?.approvedAt ?? null,
      goals,
      maxGoals: GoalsService.MAX_GOALS,
      /** Everything MaybeOS can measure, for choosing directly. */
      available: allMeasurableCategories(),
    };
  }

  async setMission(orgId: string, mission: string) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { mission: mission.trim() || null },
    });
    await this.unapprove(orgId);
    return { mission: mission.trim() || null };
  }

  async createGoal(orgId: string, data: { title: string; description?: string }) {
    const count = await this.prisma.goal.count({ where: { orgId, archivedAt: null } });
    if (count >= GoalsService.MAX_GOALS) {
      throw new BadRequestException(
        `A measurement plan holds at most ${GoalsService.MAX_GOALS} goals. Archive one to add another.`,
      );
    }

    const goal = await this.prisma.goal.create({
      data: {
        orgId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        sortOrder: count,
      },
      include: { indicators: true },
    });

    await this.unapprove(orgId);

    return {
      goal,
      // Proposed, not applied. The admin adds the ones they recognise; a plan
      // populated on their behalf is one nobody has read.
      suggested: draftIndicatorsFor(goal.title, goal.description),
    };
  }

  async updateGoal(orgId: string, goalId: string, data: { title?: string; description?: string }) {
    const goal = await this.findGoal(orgId, goalId);

    const updated = await this.prisma.goal.update({
      where: { id: goal.id },
      data: {
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.description !== undefined && { description: data.description.trim() || null }),
      },
      include: { indicators: true },
    });

    await this.unapprove(orgId);
    return { goal: updated, suggested: draftIndicatorsFor(updated.title, updated.description) };
  }

  /** Archived, not deleted — see the class comment. */
  async archiveGoal(orgId: string, goalId: string) {
    const goal = await this.findGoal(orgId, goalId);

    await this.prisma.goal.update({
      where: { id: goal.id },
      data: { archivedAt: new Date() },
    });

    await this.unapprove(orgId);
    return { archived: true };
  }

  async addIndicator(orgId: string, goalId: string, data: { category: string; label: string }) {
    const goal = await this.findGoal(orgId, goalId);

    const known = allMeasurableCategories().map((c) => c.category);
    if (!known.includes(data.category)) {
      // A category nothing asks about would sit on the plan forever with no
      // figure behind it, which reads as a goal the co-op is failing at
      // rather than one it never measured.
      throw new BadRequestException(
        `Nothing MaybeOS asks measures “${data.category}”. Choose one of: ${known.join(', ')}.`,
      );
    }

    const indicator = await this.prisma.indicator.upsert({
      where: { goalId_category: { goalId: goal.id, category: data.category } },
      create: { goalId: goal.id, category: data.category, label: data.label.trim() },
      update: { label: data.label.trim() },
    });

    await this.unapprove(orgId);
    return indicator;
  }

  async removeIndicator(orgId: string, goalId: string, indicatorId: string) {
    const goal = await this.findGoal(orgId, goalId);

    const indicator = await this.prisma.indicator.findFirst({
      where: { id: indicatorId, goalId: goal.id },
      select: { id: true },
    });
    if (!indicator) throw new NotFoundException('Indicator not found');

    await this.prisma.indicator.delete({ where: { id: indicator.id } });
    await this.unapprove(orgId);
    return { removed: true };
  }

  /**
   * Agree to the plan as it now stands.
   *
   * Refused when there is nothing to agree to. An approved empty plan is the
   * worst of both: it reads as a decision made and measures nothing.
   */
  async approve(orgId: string, userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { orgId, archivedAt: null },
      include: { indicators: { select: { id: true } } },
    });

    if (goals.length === 0) {
      throw new BadRequestException('Write at least one goal before approving the plan');
    }
    if (goals.every((g) => g.indicators.length === 0)) {
      throw new BadRequestException(
        'No goal has anything measuring it yet. Add an indicator to at least one.',
      );
    }

    const plan = await this.prisma.measurementPlan.upsert({
      where: { orgId },
      create: { orgId, status: 'APPROVED', approvedAt: new Date(), approvedById: userId },
      update: { status: 'APPROVED', approvedAt: new Date(), approvedById: userId },
    });

    return { status: plan.status, approvedAt: plan.approvedAt };
  }

  /** Resolve a goal through its org — never by bare id (SEC-04). */
  private async findGoal(orgId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, orgId },
      select: { id: true },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
  }

  /**
   * Any change to what the plan says returns it to draft.
   *
   * Silent, and it has to be: an organiser fixing a typo should not be
   * refused, they should be told the plan needs agreeing again — which the
   * status does, on the page, without an error interrupting the edit.
   */
  private async unapprove(orgId: string) {
    await this.prisma.measurementPlan.upsert({
      where: { orgId },
      create: { orgId, status: 'DRAFT' },
      update: { status: 'DRAFT', approvedAt: null, approvedById: null },
    });
  }
}
