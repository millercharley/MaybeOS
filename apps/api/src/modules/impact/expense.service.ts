import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

export interface ExpenseSummary {
  /** Everything spent in the period, in cents. */
  totalCents: number;
  /** Spend by the co-op's own category names. */
  byCategory: { category: string; totalCents: number; count: number }[];
  /** Spend attributed to a goal, and the part attributed to none. */
  byGoal: { goalId: string | null; goalTitle: string | null; totalCents: number; count: number }[];
  /**
   * The share of spend that serves a stated goal, 0–1, or null when nothing
   * was spent. This is the PRD's mission-alignment-of-spend, and it is only
   * honest because unattributed spend is recorded rather than hidden — a
   * figure computed over attributed rows alone would always be 1.
   */
  attributedShare: number | null;
  /** How many rows the figures above are built from (G5). */
  expenseCount: number;
}

/**
 * The expense side of the financial section (IMP-16), amending D-021.
 *
 * D-021 made **bookkeeping** an explicit non-goal, and that still holds. This
 * is the smallest record that gives cost-per-outcome and
 * mission-alignment-of-spend a denominator: an amount, a date, a category the
 * co-op names itself, and optionally the goal it served.
 *
 * What is deliberately absent is the point of the design — no vendors, no
 * invoices, no payment status, no reconciliation, no attachments, no approval
 * workflow, no double entry. A co-op's books live in its accounting software.
 * If something here starts needing a second table, this has outgrown its
 * decision and should be reconsidered rather than extended.
 */
@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, from?: Date, to?: Date) {
    return this.prisma.expense.findMany({
      where: { orgId, ...this.period(from, to) },
      orderBy: { incurredOn: 'desc' },
      include: { creator: { select: { id: true, name: true } } },
    });
  }

  async create(
    orgId: string,
    userId: string,
    data: {
      amountCents: number;
      incurredOn: string;
      category: string;
      goalId?: string;
      description?: string;
    },
  ) {
    return this.prisma.expense.create({
      data: {
        orgId,
        createdBy: userId,
        amountCents: data.amountCents,
        incurredOn: new Date(data.incurredOn),
        category: data.category.trim(),
        goalId: data.goalId || null,
        description: data.description?.trim() || null,
      },
    });
  }

  async update(
    orgId: string,
    expenseId: string,
    data: Partial<{
      amountCents: number;
      incurredOn: string;
      category: string;
      goalId?: string | null;
      description: string | null;
    }>,
  ) {
    // Resolved through the org, never by bare id (SEC-04).
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, orgId },
    });
    if (!existing) throw new NotFoundException('Expense not found');

    return this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(data.amountCents !== undefined && { amountCents: data.amountCents }),
        ...(data.incurredOn !== undefined && { incurredOn: new Date(data.incurredOn) }),
        ...(data.category !== undefined && { category: data.category.trim() }),
        ...(data.goalId !== undefined && { goalId: data.goalId || null }),
        ...(data.description !== undefined && {
          description: data.description?.trim() || null,
        }),
      },
    });
  }

  async remove(orgId: string, expenseId: string) {
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, orgId },
    });
    if (!existing) throw new NotFoundException('Expense not found');

    await this.prisma.expense.delete({ where: { id: expenseId } });
    return { deleted: true };
  }

  /**
   * The denominator, and nothing more.
   *
   * Returns spend broken down, not a cost-per-outcome — dividing money by
   * survey responses would produce a number that looks like a finding and is
   * not one. The composites are P1 and belong with the outcomes they divide.
   */
  async summary(orgId: string, from?: Date, to?: Date): Promise<ExpenseSummary> {
    const where = { orgId, ...this.period(from, to) };

    const [byCategory, byGoal, totals] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['goalId'],
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.expense.aggregate({
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);

    // Titles, because a uuid in a spending summary tells an organiser
    // nothing about which goal their money served.
    const goals = await this.prisma.goal.findMany({
      where: { orgId },
      select: { id: true, title: true },
    });
    const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

    const totalCents = totals._sum.amountCents ?? 0;
    const attributedCents = byGoal
      .filter((g) => g.goalId !== null)
      .reduce((n, g) => n + (g._sum.amountCents ?? 0), 0);

    return {
      totalCents,
      byCategory: byCategory
        .map((c) => ({
          category: c.category,
          totalCents: c._sum.amountCents ?? 0,
          count: c._count._all,
        }))
        .sort((a, b) => b.totalCents - a.totalCents),
      byGoal: byGoal
        .map((g) => ({
          goalId: g.goalId,
          goalTitle: g.goalId ? (goalTitle.get(g.goalId) ?? null) : null,
          totalCents: g._sum.amountCents ?? 0,
          count: g._count._all,
        }))
        .sort((a, b) => b.totalCents - a.totalCents),
      // Null rather than 0 when nothing was spent: "none of our spend serves
      // our goals" and "we have not recorded any spend" are different claims.
      attributedShare: totalCents === 0 ? null : attributedCents / totalCents,
      expenseCount: totals._count._all,
    };
  }

  private period(from?: Date, to?: Date) {
    if (!from && !to) return {};
    return {
      incurredOn: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }
}
