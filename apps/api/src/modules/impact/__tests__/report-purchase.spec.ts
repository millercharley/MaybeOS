import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { ImpactService } from '../impact.service';
import { ExpenseService } from '../expense.service';
import { ReportService } from '../report.service';
import { ReportPurchaseService } from '../report-purchase.service';
import { ComposerService } from '../composer.service';
import {
  WRITTEN_REPORT_PRICE_CENTS,
  purchaseCoversPeriod,
} from '../report-pricing';

/**
 * What the $50 does and does not buy (IMP-23, D-031).
 *
 * The paywall is one line in `publish()`, and one line is exactly how much
 * code it takes to accidentally put it across the free report instead — which
 * would break the promise the whole product is built on. So the first thing
 * asserted here is that the free report still publishes with no money
 * anywhere near it.
 */
describe('The written impact report paywall', () => {
  const period = {
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-12-31'),
  };

  let prisma: any;
  let reports: ReportService;
  let purchases: ReportPurchaseService;

  beforeEach(async () => {
    prisma = {
      impactReport: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'PUBLISHED' }),
      },
      impactReportPurchase: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        ReportPurchaseService,
        // Never reached by these tests: nothing here composes.
        { provide: ComposerService, useValue: { available: false } },
        { provide: PrismaService, useValue: prisma },
        { provide: ImpactService, useValue: {} },
        { provide: ExpenseService, useValue: {} },
      ],
    }).compile();

    reports = module.get(ReportService);
    purchases = module.get(ReportPurchaseService);
  });

  const reportIs = (tier: 'BASIC' | 'WRITTEN') =>
    prisma.impactReport.findFirst.mockResolvedValue({ id: 'r1', tier, ...period });

  const paidFor = (start: string, end: string) =>
    prisma.impactReportPurchase.findMany.mockResolvedValue([
      {
        id: 'p1',
        status: 'PAID',
        paidAt: new Date('2026-06-01'),
        periodStart: new Date(start),
        periodEnd: new Date(end),
      },
    ]);

  it('publishes the free report without asking anyone for money', async () => {
    reportIs('BASIC');

    await expect(reports.publish('org1', 'r1')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    // Not merely unpaid — never even asked. A lookup here would mean the free
    // report's fate depends on the billing table being readable.
    expect(prisma.impactReportPurchase.findMany).not.toHaveBeenCalled();
  });

  it('refuses to publish an unpaid written report, with 402 and the price', async () => {
    reportIs('WRITTEN');

    await expect(reports.publish('org1', 'r1')).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
      response: {
        reason: 'IMPACT_REPORT_UNPAID',
        priceCents: WRITTEN_REPORT_PRICE_CENTS,
      },
    });
    expect(prisma.impactReport.update).not.toHaveBeenCalled();
  });

  it('publishes a written report once its period is paid for', async () => {
    reportIs('WRITTEN');
    paidFor('2026-01-01', '2026-12-31');

    await expect(reports.publish('org1', 'r1')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
  });

  it('lets a paid year cover a report generated inside it', async () => {
    // The period is what was sold, so a Q4 reading inside a paid year is
    // covered. Charging again for it would be selling the same year twice.
    prisma.impactReport.findFirst.mockResolvedValue({
      id: 'r1',
      tier: 'WRITTEN',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-12-31'),
    });
    paidFor('2026-01-01', '2026-12-31');

    await expect(reports.publish('org1', 'r1')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
  });

  it('does not let last year’s purchase cover this year', async () => {
    reportIs('WRITTEN');
    paidFor('2025-01-01', '2025-12-31');

    await expect(reports.publish('org1', 'r1')).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
    });
  });

  it('ignores a purchase that was started but never paid', async () => {
    reportIs('WRITTEN');
    // `status: 'PAID'` is in the query, so a PENDING row is never returned —
    // asserted by the query rather than by trusting the caller.
    await expect(reports.publish('org1', 'r1')).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
    });
    expect(prisma.impactReportPurchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('scopes the entitlement lookup to the org', async () => {
    reportIs('WRITTEN');
    paidFor('2026-01-01', '2026-12-31');

    await reports.publish('org1', 'r1');

    // SEC-04: a purchase by another co-op must never entitle this one.
    expect(prisma.impactReportPurchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org1' }),
      }),
    );
  });

  describe('export is gated too, or the paywall is a formality (IMP-26)', () => {
    // Charley, 2026-08-27: "charge to publish or export". Publishing and
    // exporting are the only two ways the finished artefact leaves MaybeOS,
    // so charging for one and not the other would let anybody walk around
    // the paywall by pressing the other button.
    beforeEach(() => {
      prisma.impactReport.findFirst.mockResolvedValue({
        id: 'r1',
        title: 'Sunrise: 2026 impact',
        tier: 'WRITTEN',
        status: 'DRAFT',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        publishedAt: null,
        generatedAt: new Date('2027-01-10'),
        org: { name: 'Sunrise', mission: null },
        blocks: [{ kind: 'intro', heading: 'About', body: 'Something true.' }],
      });
    });

    it('refuses to export an unpaid written report', async () => {
      await expect(reports.exportDocument('org1', 'r1')).rejects.toMatchObject({
        status: HttpStatus.PAYMENT_REQUIRED,
      });
    });

    it('exports it once the period is paid for', async () => {
      paidFor('2026-01-01', '2026-12-31');
      await expect(reports.exportDocument('org1', 'r1')).resolves.toMatchObject({
        filename: expect.stringContaining('.html'),
      });
    });

    it('exports the free report without asking anyone for money', async () => {
      prisma.impactReport.findFirst.mockResolvedValue({
        id: 'r1',
        title: 'Sunrise: 2026 impact',
        tier: 'BASIC',
        status: 'DRAFT',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        publishedAt: null,
        generatedAt: new Date('2027-01-10'),
        org: { name: 'Sunrise', mission: null },
        blocks: [],
      });

      await expect(reports.exportDocument('org1', 'r1')).resolves.toBeDefined();
      expect(prisma.impactReportPurchase.findMany).not.toHaveBeenCalled();
    });

    it('stops asking once the report is published, because the page is public', async () => {
      // There is nothing left to gate: publishing was the paid act, and the
      // report is readable by anyone with the link from that moment.
      prisma.impactReport.findFirst.mockResolvedValue({
        id: 'r1',
        title: 'Sunrise: 2026 impact',
        tier: 'WRITTEN',
        status: 'PUBLISHED',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        publishedAt: null,
        generatedAt: new Date('2027-01-10'),
        org: { name: 'Sunrise', mission: null },
        blocks: [],
      });

      await expect(reports.exportDocument('org1', 'r1')).resolves.toBeDefined();
      expect(prisma.impactReportPurchase.findMany).not.toHaveBeenCalled();
    });
  });

  describe('statusFor — what the admin sees before deciding', () => {
    it('offers nothing to buy on a free report', async () => {
      reportIs('BASIC');
      await expect(purchases.statusFor('org1', 'r1')).resolves.toMatchObject({
        required: false,
        paid: false,
      });
    });

    it('names the price and the covering purchase once bought', async () => {
      reportIs('WRITTEN');
      paidFor('2026-01-01', '2026-12-31');

      await expect(purchases.statusFor('org1', 'r1')).resolves.toMatchObject({
        required: true,
        paid: true,
        priceCents: WRITTEN_REPORT_PRICE_CENTS,
        coveredBy: { id: 'p1' },
      });
    });
  });

  describe('purchaseCoversPeriod', () => {
    const p = (s: string, e: string) => ({
      periodStart: new Date(s),
      periodEnd: new Date(e),
    });

    it('covers an identical period', () => {
      expect(purchaseCoversPeriod(p('2026-01-01', '2026-12-31'), p('2026-01-01', '2026-12-31'))).toBe(true);
    });

    it('covers a period nudged inside it', () => {
      expect(purchaseCoversPeriod(p('2026-01-01', '2026-12-31'), p('2026-01-02', '2026-12-30'))).toBe(true);
    });

    it('does not cover a period that runs past its end', () => {
      expect(purchaseCoversPeriod(p('2026-01-01', '2026-12-31'), p('2026-01-01', '2027-01-01'))).toBe(false);
    });

    it('does not cover a period that starts before it', () => {
      expect(purchaseCoversPeriod(p('2026-01-01', '2026-12-31'), p('2025-12-31', '2026-12-31'))).toBe(false);
    });
  });
});
