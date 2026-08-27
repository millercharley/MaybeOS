import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../config/prisma.service';
import { ImpactService } from '../impact.service';
import { ExpenseService } from '../expense.service';
import { ReportService } from '../report.service';
import { ReportPurchaseService } from '../report-purchase.service';
import { ComposerService } from '../composer.service';

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
