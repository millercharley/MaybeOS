import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReportService, editedShare } from '../report.service';
import { ImpactService } from '../impact.service';
import { ExpenseService } from '../expense.service';
import { ReportPurchaseService } from '../report-purchase.service';
import { ComposerService } from '../composer.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The year-end report (IMP-22).
 *
 * This is the only artefact a co-op sends to somebody with money, so the
 * tests are about what it refuses to say rather than what it says.
 */
describe('ReportService', () => {
  let service: ReportService;
  let prisma: any;
  let impact: any;
  let expenses: any;

  const signal = (over: Record<string, unknown> = {}) => ({
    category: 'belonging',
    average: 3.8,
    answerCount: 12,
    respondents: 9,
    reportable: true,
    higherIsBetter: true,
    ...over,
  });

  const signalsWith = (measures: unknown[], over: Record<string, unknown> = {}) => ({
    suppressionThreshold: 5,
    members: 40,
    categories: [],
    windows: [
      { windowId: 'w1', label: '2026 baseline', opensAt: new Date(), closesAt: null, responses: 9, responseRate: 23 },
    ],
    goals: [{ goalId: 'g1', title: 'People feel they belong', description: null, unmeasured: false, measures }],
    unclaimed: [],
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Sunrise', mission: 'A city where nobody is alone' }) },
      impactReport: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'r1',
          ...data,
          blocks: (data.blocks?.create ?? []).map((b: any, i: number) => ({ id: `b${i}`, isEdited: false, ...b })),
        })),
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'PUBLISHED' }),
      },
      reportBlock: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', generatedBody: 'as written' }),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'b1', ...data })),
      },
      // No purchases by default: the free report must not need one (IMP-23).
      impactReportPurchase: { findMany: jest.fn().mockResolvedValue([]) },
    };
    impact = { getSignalsByGoal: jest.fn().mockResolvedValue(signalsWith([{ indicatorId: 'i1', label: 'Belonging', category: 'belonging', signal: signal() }])) };
    expenses = { summary: jest.fn().mockResolvedValue({ totalCents: 0, byCategory: [], byGoal: [], attributedShare: null, expenseCount: 0 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImpactService, useValue: impact },
        { provide: ExpenseService, useValue: expenses },
        // The real one, against the mock client: whether a written report is
        // paid for is the thing being tested, not a thing being stubbed.
        ReportPurchaseService,
        // Never reached by these tests: nothing here composes.
        { provide: ComposerService, useValue: { available: false } },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  const blocksOf = (result: any) => result.blocks as any[];

  describe('what it refuses to publish', () => {
    it('will not write a report with nothing reportable in it', async () => {
      // A report with no figures is worse than no report: it is a document a
      // co-op might send.
      impact.getSignalsByGoal.mockResolvedValue(
        signalsWith([{ indicatorId: 'i1', label: 'Belonging', category: 'belonging', signal: signal({ reportable: false, average: null, respondents: 3 }) }]),
      );

      await expect(service.generate('org-1', 'u1', {})).rejects.toThrow(BadRequestException);
    });

    it('keeps suppressed figures out of the blocks entirely', async () => {
      // A report is public. A small cell reaching it is not an admin seeing a
      // member's answer — it is the internet seeing it. So it must not be
      // written at all, rather than written and hidden by the page.
      impact.getSignalsByGoal.mockResolvedValue(
        signalsWith([
          { indicatorId: 'i1', label: 'Belonging', category: 'belonging', signal: signal() },
          { indicatorId: 'i2', label: 'Loneliness', category: 'loneliness', signal: signal({ category: 'loneliness', average: 4.4, respondents: 2, reportable: false }) },
        ]),
      );

      const report = await service.generate('org-1', 'u1', {});
      const goalBlock = blocksOf(report).find((b) => b.kind === 'goal');

      expect(JSON.stringify(goalBlock.data)).not.toContain('loneliness');
      expect(goalBlock.body).not.toContain('4.4');
      expect(goalBlock.data.figures).toHaveLength(1);
    });

    it('names a goal it cannot report on rather than dropping it', async () => {
      // A goal quietly missing reads as one the co-op abandoned.
      impact.getSignalsByGoal.mockResolvedValue(
        signalsWith(
          [{ indicatorId: 'i1', label: 'Belonging', category: 'belonging', signal: signal() }],
          {
            goals: [
              { goalId: 'g1', title: 'People feel they belong', description: null, unmeasured: false, measures: [{ indicatorId: 'i1', label: 'Belonging', category: 'belonging', signal: signal() }] },
              { goalId: 'g2', title: 'People know their neighbours', description: null, unmeasured: false, measures: [{ indicatorId: 'i2', label: 'Network', category: 'network_size', signal: signal({ category: 'network_size', reportable: false, average: null, respondents: 1 }) }] },
            ],
          },
        ),
      );

      const report = await service.generate('org-1', 'u1', {});
      const goalBlocks = blocksOf(report).filter((b) => b.kind === 'goal');

      expect(goalBlocks).toHaveLength(2);
      expect(goalBlocks[1].body).toMatch(/too few people/i);
      expect(goalBlocks[1].data.reportable).toBe(false);
    });

    it('refuses a period that ends before it starts', async () => {
      await expect(
        service.generate('org-1', 'u1', { periodStart: '2026-12-01', periodEnd: '2026-01-01' }),
      ).rejects.toThrow(/start before it ends/i);
    });
  });

  describe('G5 — every figure traces to a count and a window', () => {
    it('freezes the respondent count into the block', async () => {
      const report = await service.generate('org-1', 'u1', {});
      const goalBlock = blocksOf(report).find((b) => b.kind === 'goal');

      expect(goalBlock.data.figures[0]).toMatchObject({ average: 3.8, respondents: 9, answerCount: 12 });
      // And says it in the prose, not only in the payload.
      expect(goalBlock.body).toMatch(/from 9 people/);
      // The scale is stated once. It read "3.8 out of 5 (3.8 out of 5, higher
      // is better)" before this was caught by reading real output.
      expect(goalBlock.body.match(/out of 5/g)).toHaveLength(1);
    });

    it('always ends with where the figures came from', async () => {
      const report = await service.generate('org-1', 'u1', {});
      const last = blocksOf(report).at(-1);

      expect(last.kind).toBe('provenance');
      expect(last.data.windows[0]).toMatchObject({ label: '2026 baseline', responses: 9 });
      expect(last.body).toMatch(/at least 5 people/);
    });
  });

  describe('editing', () => {
    beforeEach(() => {
      prisma.impactReport.findFirst.mockResolvedValue({ id: 'r1', status: 'DRAFT' });
    });

    it('keeps what MaybeOS wrote beside what the co-op changed', async () => {
      const updated = await service.updateBlock('org-1', 'r1', 'b1', 'our own words');

      expect(updated.body).toBe('our own words');
      expect(updated.isEdited).toBe(true);
    });

    it('does not mark an unchanged block as edited', async () => {
      const updated = await service.updateBlock('org-1', 'r1', 'b1', '  as written  ');

      expect(updated.isEdited).toBe(false);
    });

    it('refuses to edit a published report in place', async () => {
      // People have been sent this. Changing it silently changes what they
      // were sent.
      prisma.impactReport.findFirst.mockResolvedValue({ id: 'r1', status: 'PUBLISHED' });

      await expect(service.updateBlock('org-1', 'r1', 'b1', 'x')).rejects.toThrow(/unpublish/i);
    });
  });

  describe('the public view', () => {
    it('does not exist for a draft', async () => {
      // Not found rather than forbidden: confirming a co-op has an
      // unpublished report is itself something it did not choose to share.
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Sunrise', slug: 'sunrise' });
      prisma.impactReport.findFirst.mockResolvedValue(null);

      await expect(service.getPublic('sunrise', 'draft-one')).rejects.toThrow(/not found/i);
      // The status filter is what does it, not a check after the fact.
      expect(prisma.impactReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
      );
    });

    it('does not tell a reader which paragraphs were rewritten', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Sunrise', slug: 'sunrise' });
      prisma.impactReport.findFirst.mockResolvedValue({ title: 't', blocks: [] });

      await service.getPublic('sunrise', 'r');

      const select = prisma.impactReport.findFirst.mock.calls[0][0].select.blocks.select;
      expect(select).not.toHaveProperty('isEdited');
      expect(select).not.toHaveProperty('generatedBody');
    });
  });

  describe('editedShare — the PRD’s G4, computed rather than claimed', () => {
    it('is the share of blocks a human rewrote', () => {
      expect(editedShare([{ isEdited: true }, { isEdited: false }, { isEdited: false }, { isEdited: false }])).toBe(0.25);
      expect(editedShare([])).toBe(0);
    });
  });
});
