import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../config/prisma.service';
import { ImpactService } from '../impact.service';
import { ExpenseService } from '../expense.service';
import { ReportService } from '../report.service';
import { ReportPurchaseService } from '../report-purchase.service';
import { ComposerService } from '../composer.service';
import { ServiceService } from '../../service/service.service';

/**
 * Writing the prose over a report that already reads correctly (IMP-23
 * phase 2).
 *
 * The property that makes every failure here survivable: the written report
 * *is* the free report until the composition lands. So a model that is down,
 * slow, or wrong costs a co-op flat sentences, never a broken document — and
 * never money, because the charge happens at publish.
 */
describe('ReportService.compose', () => {
  let prisma: any;
  let composer: any;
  let service: ReportService;

  const blocks = [
    { id: 'b1', kind: 'intro', heading: 'About', generatedBody: 'Flat.', data: { members: 84 }, isEdited: false },
    { id: 'b2', kind: 'goal', heading: 'Belonging', generatedBody: 'A sentence.', data: { figures: [] }, isEdited: false },
    { id: 'b3', kind: 'provenance', heading: 'Where from', generatedBody: 'The guarantee.', data: {}, isEdited: false },
  ];

  beforeEach(async () => {
    prisma = {
      impactReport: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          orgId: 'org1',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-12-31'),
          org: { name: 'Sunrise', mission: null },
          blocks,
        }),
      },
      reportBlock: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    composer = {
      compose: jest.fn().mockResolvedValue({
        outcome: 'composed',
        attempts: 1,
        blocks: [
          { id: 'b1', body: 'Better prose about the co-op.' },
          { id: 'b2', body: 'Better prose about belonging.' },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImpactService, useValue: {} },
        { provide: ExpenseService, useValue: {} },
        { provide: ReportPurchaseService, useValue: {} },
        { provide: ComposerService, useValue: composer },
        {
          provide: ServiceService,
          useValue: {
            contribution: jest.fn().mockResolvedValue({
              timezone: 'UTC',
              turns: 0,
              totalMinutes: 0,
              totalHours: 0,
              members: 0,
              hourValueCents: null,
              valueCents: null,
              correctedTurns: 0,
              byDuty: [],
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ReportService);
  });

  it('claims the report before doing anything, so two runners cannot interleave drafts', async () => {
    await service.compose('org1', 'r1');

    // Conditional update rather than read-then-write: Netlify may invoke a
    // background function more than once, and two composers writing the same
    // blocks would splice paragraphs from two drafts into one section.
    expect(prisma.impactReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'r1',
          orgId: 'org1',
          tier: 'WRITTEN',
          composeStatus: { in: ['PENDING', 'FAILED'] },
        }),
        data: { composeStatus: 'COMPOSING' },
      }),
    );
  });

  it('does nothing at all when it cannot claim it', async () => {
    prisma.impactReport.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.compose('org1', 'r1')).resolves.toEqual({ status: 'skipped' });
    expect(composer.compose).not.toHaveBeenCalled();
  });

  it('writes the composed bodies and marks it ready', async () => {
    const result = await service.compose('org1', 'r1');

    expect(result).toMatchObject({ status: 'ready' });
    const writes = prisma.reportBlock.update.mock.calls.map((c: any[]) => c[0]);
    expect(writes).toHaveLength(2);
    expect(writes[0].data).toEqual({
      body: 'Better prose about the co-op.',
      // Both, because after this the composed text *is* what MaybeOS wrote,
      // and editedShare measures the co-op against what it was handed.
      generatedBody: 'Better prose about the co-op.',
    });
  });

  it('never rewrites the provenance block', async () => {
    await service.compose('org1', 'r1');

    const written = prisma.reportBlock.update.mock.calls.map((c: any[]) => c[0].where.id);
    expect(written).not.toContain('b3');
  });

  it('leaves a report the admin has already edited alone', async () => {
    prisma.impactReport.findFirst.mockResolvedValue({
      id: 'r1',
      orgId: 'org1',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      org: { name: 'Sunrise', mission: null },
      blocks: [{ ...blocks[0], isEdited: true }, blocks[1], blocks[2]],
    });

    // An admin who rewrote a paragraph said something about their own co-op.
    // Overwriting it is the one outcome here that costs them anything.
    const result = await service.compose('org1', 'r1');

    expect(result).toMatchObject({ status: 'failed' });
    expect(composer.compose).not.toHaveBeenCalled();
    expect(prisma.reportBlock.update).not.toHaveBeenCalled();
  });

  it('records why it gave up, and leaves the report readable', async () => {
    composer.compose.mockResolvedValue({ outcome: 'gave-up', reason: 'The draft kept breaking the rules' });

    const result = await service.compose('org1', 'r1');

    expect(result).toMatchObject({ status: 'failed', note: 'The draft kept breaking the rules' });
    expect(prisma.impactReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { composeStatus: 'FAILED', composeNote: 'The draft kept breaking the rules' },
      }),
    );
    // The deterministic bodies are untouched, so the report still reads.
    expect(prisma.reportBlock.update).not.toHaveBeenCalled();
  });

  it('passes the period’s years through, so a year is not an ungrounded number', async () => {
    await service.compose('org1', 'r1');

    // One entry, de-duplicated, and read in UTC — a period stored as a UTC
    // midnight formatted in a western local zone would otherwise name a year
    // the validator has never heard of.
    expect(composer.compose).toHaveBeenCalledWith(expect.anything(), [2026]);
  });
});

import { ReportService as RS } from '../report.service';

/**
 * The two sections only the written report carries (IMP-23, PRD §6.6).
 *
 * Both are composed deterministically first so a failed generation leaves a
 * section that reads correctly rather than a heading over nothing — which
 * means the deterministic text is shipped prose, not a placeholder, and has
 * to be written like it.
 */
/** A co-op with no rota, which is every co-op until an organiser adds a duty. */
const NO_SERVICE = {
  timezone: 'UTC',
  turns: 0,
  totalMinutes: 0,
  totalHours: 0,
  members: 0,
  hourValueCents: null,
  valueCents: null,
  correctedTurns: 0,
  byDuty: [],
};

describe('the written report’s own sections', () => {
  const compose = (goals: any[], threshold = 5) =>
    (RS.prototype as any).composeBlocks.call(
      {},
      {
        org: { name: 'Sunrise', mission: null },
        signals: { goals, members: 8, suppressionThreshold: threshold, windows: [] },
        spend: { totalCents: 0, byCategory: [], byGoal: [], attributedShare: null, expenseCount: 0 },
        contribution: NO_SERVICE,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        tier: 'WRITTEN',
      },
    );

  const measured = (title: string, respondents = 12) => ({
    title,
    description: null,
    measures: [
      {
        label: 'Belonging',
        signal: { category: 'belonging', average: 3.7, respondents, answerCount: respondents, reportable: true, higherIsBetter: true },
      },
    ],
  });
  const quiet = (title: string) => ({ title, description: null, measures: [] });

  const limitationsOf = (goals: any[]) =>
    compose(goals).find((b: any) => b.kind === 'limitations').body as string;

  it('agrees with itself about one goal', () => {
    // Found by running it: "1 goal have no figure at all … answered about
    // them." The deterministic text is what a co-op reads when the model
    // fails, so a grammar bug here is a grammar bug in a funder's copy.
    const body = limitationsOf([measured('Belonging'), quiet('The building pays for itself')]);

    expect(body).toContain('1 goal has no figure at all');
    expect(body).toContain('answered about it.');
    expect(body).not.toContain('goal have');
  });

  it('and about several', () => {
    const body = limitationsOf([measured('Belonging'), quiet('One'), quiet('Two')]);

    expect(body).toContain('2 goals have no figure at all');
    expect(body).toContain('answered about them.');
  });

  it('names a figure that only just cleared suppression as thin', () => {
    const body = limitationsOf([measured('Belonging', 6)]);
    expect(body).toContain('rest on small numbers');
    expect(body).toContain('6 people');
  });

  it('does not call a well-answered figure thin', () => {
    const body = limitationsOf([measured('Belonging', 40)]);
    expect(body).not.toContain('rest on small numbers');
  });

  it('always says the data cannot show cause', () => {
    // The single most important sentence in the report, and the one a funder
    // is entitled to. It is unconditional.
    expect(limitationsOf([measured('Belonging')])).toContain('do not say why');
  });

  it('gives the free report neither section', () => {
    const blocks = (RS.prototype as any).composeBlocks.call(
      {},
      {
        org: { name: 'Sunrise', mission: null },
        signals: { goals: [measured('Belonging')], members: 8, suppressionThreshold: 5, windows: [] },
        spend: { totalCents: 0, byCategory: [], byGoal: [], attributedShare: null, expenseCount: 0 },
        contribution: NO_SERVICE,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        tier: 'BASIC',
      },
    );
    expect(blocks.map((b: any) => b.kind)).not.toContain('limitations');
    expect(blocks.map((b: any) => b.kind)).not.toContain('synthesis');
  });
});
