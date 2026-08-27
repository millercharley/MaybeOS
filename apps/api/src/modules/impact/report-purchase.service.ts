import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  WRITTEN_REPORT_PRICE_CENTS,
  purchaseCoversPeriod,
} from './report-pricing';

/**
 * Whether a co-op has paid for the written report, and for which period
 * (IMP-23).
 *
 * **Read side only.** Creating the Checkout session and settling it from the
 * webhook live in `StripeService`, beside every other charge MaybeOS makes,
 * for the same reason ticket sales do: there is one signature-verified entry
 * point and one Stripe client, and a second copy of either is a second thing
 * to get wrong. What is here is the question the rest of the product asks —
 * *may this co-op publish this?* — which needs no Stripe at all.
 *
 * The charge happens at publish or export, not at generation (Charley,
 * 2026-08-27). A co-op can generate a written report and read it before
 * deciding; what it pays for is putting it in front of a funder. Generation
 * costs pennies and a report nobody can read first is a report nobody buys.
 */
@Injectable()
export class ReportPurchaseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The paid purchase covering this period, or null.
   *
   * Filtered in memory rather than in SQL because coverage is containment in
   * both directions and the row count per co-op is measured in single digits —
   * a co-op buys this once a year.
   */
  async entitlementFor(
    orgId: string,
    period: { periodStart: Date; periodEnd: Date },
  ) {
    const paid = await this.prisma.impactReportPurchase.findMany({
      where: { orgId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
    });
    return paid.find((p) => purchaseCoversPeriod(p, period)) ?? null;
  }

  /**
   * Refuse the action unless the period is paid for.
   *
   * 402 rather than 403: the co-op is not forbidden from doing this, it has
   * not bought it yet, and the web app branches on that to offer the purchase
   * instead of an apology.
   */
  async requireEntitlement(
    orgId: string,
    period: { periodStart: Date; periodEnd: Date },
    action: string,
  ) {
    const entitlement = await this.entitlementFor(orgId, period);
    if (!entitlement) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `The written report for this period hasn't been bought yet. It's $${(
            WRITTEN_REPORT_PRICE_CENTS / 100
          ).toFixed(2)}, once, and covers every version of the report for this period — including the one you ${action} after revising it.`,
          reason: 'IMPACT_REPORT_UNPAID',
          priceCents: WRITTEN_REPORT_PRICE_CENTS,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return entitlement;
  }

  /**
   * What the admin sees on the report page before deciding: the price, and
   * whether this period is already covered.
   */
  async statusFor(orgId: string, reportId: string) {
    const report = await this.prisma.impactReport.findFirst({
      where: { id: reportId, orgId },
      select: { id: true, tier: true, periodStart: true, periodEnd: true },
    });
    if (!report) throw new NotFoundException('Report not found');

    const entitlement = await this.entitlementFor(orgId, report);

    return {
      reportId: report.id,
      tier: report.tier,
      priceCents: WRITTEN_REPORT_PRICE_CENTS,
      // A basic report is never gated, so the page should not offer to sell
      // anything on it.
      required: report.tier === 'WRITTEN',
      paid: entitlement !== null,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      coveredBy: entitlement
        ? {
            id: entitlement.id,
            paidAt: entitlement.paidAt,
            periodStart: entitlement.periodStart,
            periodEnd: entitlement.periodEnd,
          }
        : null,
    };
  }

  /** Every purchase a co-op has made, for its billing page. */
  async listForOrg(orgId: string) {
    return this.prisma.impactReportPurchase.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amountCents: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }
}
