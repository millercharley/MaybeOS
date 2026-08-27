import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { ImpactService } from './impact.service';
import { ExpenseService } from './expense.service';
import { ReportPurchaseService } from './report-purchase.service';
import { CATEGORY_PHRASE } from './report-language';

/**
 * The year-end report (IMP-22, PRD §7).
 *
 * The only part of ImpactOS a co-op ever shows anyone — a grant panel, a
 * board, a members' meeting. Everything else in the module is machinery for
 * making this truthful.
 *
 * Three rules decide the design, and all three are about not lying:
 *
 * **Frozen at generation.** Figures are written into the blocks when the
 * report is made and never recomputed. A report published in January that
 * quietly reads differently in March is the worst failure available here: the
 * number a funder was sent has to stay the number they see. Regenerating
 * makes a *new* report rather than editing history.
 *
 * **G5, carried rather than promised.** Every figure block stores the
 * respondent count and the collection window it came from, so a reader can
 * always ask "out of how many, and when" and the report answers. A figure
 * that cannot answer that is one a funder discounts, and rightly.
 *
 * **Suppression survives publication.** A report is public — that is the
 * point of it — so a small cell reaching a report page is not an admin seeing
 * a member's answer, it is the *internet* seeing it. Nothing below the
 * threshold is written into a block at all, rather than being written and
 * hidden by the page.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly impact: ImpactService,
    private readonly expenses: ExpenseService,
    private readonly purchases: ReportPurchaseService,
  ) {}

  async list(orgId: string) {
    return this.prisma.impactReport.findMany({
      where: { orgId },
      orderBy: { periodEnd: 'desc' },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        tier: true,
        periodStart: true,
        periodEnd: true,
        publishedAt: true,
        generatedAt: true,
        _count: { select: { blocks: true } },
      },
    });
  }

  async get(orgId: string, reportId: string) {
    const report = await this.prisma.impactReport.findFirst({
      where: { id: reportId, orgId },
      include: { blocks: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!report) throw new NotFoundException('Report not found');

    return { ...report, editedShare: editedShare(report.blocks) };
  }

  /**
   * Write a report from what the co-op actually collected.
   *
   * Refuses rather than producing an empty one. A report with no figures in
   * it is worse than no report: it is a document a co-op might send.
   */
  async generate(
    orgId: string,
    userId: string,
    input: {
      title?: string;
      periodStart?: string;
      periodEnd?: string;
      tier?: 'BASIC' | 'WRITTEN';
    },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, mission: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date();
    const periodStart = input.periodStart
      ? new Date(input.periodStart)
      : new Date(periodEnd.getFullYear() - 1, periodEnd.getMonth(), periodEnd.getDate());

    if (periodStart >= periodEnd) {
      throw new BadRequestException('The period has to start before it ends');
    }

    const [signals, spend] = await Promise.all([
      this.impact.getSignalsByGoal(orgId),
      this.expenses.summary(orgId),
    ]);

    const reportable = signals.goals.flatMap((g) =>
      g.measures.filter((m) => m.signal?.reportable && m.signal.average !== null),
    );

    if (reportable.length === 0) {
      throw new BadRequestException(
        `Nothing can be reported yet. A figure needs at least ${signals.suppressionThreshold} people to have answered, so that no one's answer can be worked out from it.`,
      );
    }

    const title = input.title?.trim() || `${org.name}: ${periodEnd.getFullYear()} impact`;
    const slug = await this.uniqueSlug(orgId, title);

    const blocks = this.composeBlocks({ org, signals, spend, periodStart, periodEnd });

    const report = await this.prisma.impactReport.create({
      data: {
        orgId,
        title,
        slug,
        periodStart,
        periodEnd,
        // Free to generate either kind. A co-op that cannot read the written
        // report before deciding has no way to judge whether it is worth $50,
        // and the composition costs pennies (IMP-23).
        tier: input.tier ?? 'BASIC',
        generatedAt: new Date(),
        createdById: userId,
        blocks: {
          create: blocks.map((b, i) => ({
            sortOrder: i,
            kind: b.kind,
            heading: b.heading,
            body: b.body,
            generatedBody: b.body,
            data: (b.data ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        },
      },
      include: { blocks: { orderBy: { sortOrder: 'asc' } } },
    });

    return { ...report, editedShare: 0 };
  }

  /**
   * Rewrite one block.
   *
   * The generated text is kept beside it rather than replaced, so a co-op can
   * see what it changed and MaybeOS can say honestly how much of the report a
   * human wrote. The **figures are not editable** — only the prose around
   * them. An editable number in a document that claims every figure traces to
   * a response count is not a report, it is a form.
   */
  async updateBlock(orgId: string, reportId: string, blockId: string, body: string) {
    const report = await this.prisma.impactReport.findFirst({
      where: { id: reportId, orgId },
      select: { id: true, status: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status === 'PUBLISHED') {
      // A published report is a thing people have been sent. Editing it in
      // place would change what they were sent, silently.
      throw new BadRequestException(
        'This report is published. Unpublish it first, so nobody is reading it while it changes.',
      );
    }

    const block = await this.prisma.reportBlock.findFirst({
      where: { id: blockId, reportId: report.id },
      select: { id: true, generatedBody: true },
    });
    if (!block) throw new NotFoundException('Block not found');

    return this.prisma.reportBlock.update({
      where: { id: block.id },
      data: {
        body: body.trim(),
        isEdited: body.trim() !== (block.generatedBody ?? '').trim(),
      },
    });
  }

  /**
   * Make it readable by anyone with the link — which is the point of it.
   *
   * For a **written** report this is also the moment it is paid for (IMP-23).
   * Publishing is the act with the value in it: a draft nobody can open has
   * not been used for anything. Charging at generation instead would make a
   * co-op buy a report it has not read, and charging per revision would make
   * it publish the first draft rather than the true one.
   */
  async publish(orgId: string, reportId: string) {
    const report = await this.prisma.impactReport.findFirst({
      where: { id: reportId, orgId },
      select: { id: true, tier: true, periodStart: true, periodEnd: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    if (report.tier === 'WRITTEN') {
      await this.purchases.requireEntitlement(orgId, report, 'publish');
    }

    return this.prisma.impactReport.update({
      where: { id: report.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      select: { id: true, slug: true, status: true, publishedAt: true },
    });
  }

  async unpublish(orgId: string, reportId: string) {
    const report = await this.prisma.impactReport.findFirst({
      where: { id: reportId, orgId },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    return this.prisma.impactReport.update({
      where: { id: report.id },
      data: { status: 'DRAFT' },
      select: { id: true, status: true },
    });
  }

  /**
   * A published report, by slug, to anybody.
   *
   * Unauthenticated by design and the one ImpactOS endpoint that is. A draft
   * is invisible here — not 403, but genuinely not found, since confirming
   * that a co-op has an unpublished report is itself something it did not
   * choose to share.
   */
  async getPublic(orgSlug: string, reportSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true, logoUrl: true, mission: true },
    });
    if (!org) throw new NotFoundException('Report not found');

    const report = await this.prisma.impactReport.findFirst({
      where: { orgId: org.id, slug: reportSlug, status: 'PUBLISHED' },
      select: {
        title: true,
        slug: true,
        periodStart: true,
        periodEnd: true,
        publishedAt: true,
        generatedAt: true,
        blocks: {
          orderBy: { sortOrder: 'asc' },
          // No `isEdited` and no `generatedBody`: which paragraphs a co-op
          // rewrote is its own business, not a reader's.
          select: { id: true, kind: true, heading: true, body: true, data: true },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');

    return { org, report };
  }

  /* ─── Composition ─────────────────────────────────────────── */

  private composeBlocks(input: {
    org: { name: string; mission: string | null };
    signals: Awaited<ReturnType<ImpactService['getSignalsByGoal']>>;
    spend: Awaited<ReturnType<ExpenseService['summary']>>;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const { org, signals, spend, periodStart, periodEnd } = input;
    const blocks: Array<{
      kind: string;
      heading?: string;
      body?: string;
      data?: Prisma.InputJsonValue;
    }> = [];

    const period = `${periodStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} – ${periodEnd.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;

    blocks.push({
      kind: 'intro',
      heading: 'About this report',
      body:
        `${org.name} asked its members a short question at a time over ${period}. ` +
        `This is what they said.` +
        (org.mission ? `\n\nOur mission: ${org.mission}` : ''),
      data: { period, members: signals.members },
    });

    for (const goal of signals.goals) {
      const measured = goal.measures.filter((m) => m.signal?.reportable && m.signal.average !== null);

      if (measured.length === 0) {
        // Named rather than dropped. A goal quietly missing from a report
        // reads as a goal the co-op abandoned; saying "not enough answers" is
        // both true and the more useful thing for a reader to know.
        blocks.push({
          kind: 'goal',
          heading: goal.title,
          body:
            goal.description
              ? `${goal.description}\n\nToo few people have answered about this to report a figure yet.`
              : 'Too few people have answered about this to report a figure yet.',
          data: { goalId: goal.goalId, reportable: false },
        });
        continue;
      }

      const sentences = measured.map((m) => {
        const s = m.signal!;
        const phrase = CATEGORY_PHRASE[s.category];
        const value = s.average!.toFixed(1);
        const direction = s.higherIsBetter ? 'higher is better' : 'lower is better';
        // The phrase already carries the number, and for a count like
        // "how many people could you ask for a favour" an "out of 5" would be
        // wrong as well as repetitive — so only the direction is added.
        return phrase
          ? `${phrase(value)} (${direction}), from ${s.respondents} ${people(s.respondents)}.`
          : `${m.label}: ${value} out of 5 (${direction}), from ${s.respondents} ${people(s.respondents)}.`;
      });

      blocks.push({
        kind: 'goal',
        heading: goal.title,
        body: [goal.description, ...sentences].filter(Boolean).join('\n\n'),
        // Frozen, so the block can still answer "out of how many, and when"
        // long after the underlying answers have grown.
        data: {
          goalId: goal.goalId,
          reportable: true,
          figures: measured.map((m) => ({
            label: m.label,
            category: m.signal!.category,
            average: m.signal!.average,
            respondents: m.signal!.respondents,
            answerCount: m.signal!.answerCount,
            higherIsBetter: m.signal!.higherIsBetter,
          })),
        },
      });
    }

    if (spend.totalCents > 0) {
      const attributed = spend.attributedShare;
      blocks.push({
        kind: 'spend',
        heading: 'What it cost',
        body:
          `${org.name} recorded ${money(spend.totalCents)} of spending over this period` +
          (attributed !== null
            ? `, of which ${Math.round(attributed * 100)}% served a stated goal.`
            : '.') +
          `\n\nSpend with no goal against it is counted too — a figure computed only over` +
          ` attributed spending would always be 100%.`,
        data: {
          totalCents: spend.totalCents,
          attributedShare: attributed,
          byGoal: spend.byGoal,
          expenseCount: spend.expenseCount,
        },
      });
    }

    // Last, and always present: this is what separates a report from a claim.
    blocks.push({
      kind: 'provenance',
      heading: 'Where these figures come from',
      body:
        `Every figure above comes from members answering one question at a time, at moments ` +
        `they were already in — never more than one question per member per month.\n\n` +
        `Nothing is reported unless at least ${signals.suppressionThreshold} people answered it, ` +
        `so that no individual's answer can be worked out from a total. Individual answers are ` +
        `never shown to anyone, including this co-op's own organisers.`,
      data: {
        suppressionThreshold: signals.suppressionThreshold,
        members: signals.members,
        windows: signals.windows.map((w) => ({
          label: w.label,
          opensAt: w.opensAt,
          closesAt: w.closesAt,
          responses: w.responses,
          responseRate: w.responseRate,
        })),
      },
    });

    return blocks;
  }

  private async uniqueSlug(orgId: string, title: string) {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'impact-report';

    for (let n = 0; ; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await this.prisma.impactReport.findFirst({
        where: { orgId, slug },
        select: { id: true },
      });
      if (!taken) return slug;
    }
  }
}

/** How much of the report a human rewrote — the PRD's G4, computed not claimed. */
export function editedShare(blocks: Array<{ isEdited: boolean }>): number {
  if (blocks.length === 0) return 0;
  return blocks.filter((b) => b.isEdited).length / blocks.length;
}

const people = (n: number) => (n === 1 ? 'person' : 'people');

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
