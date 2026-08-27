/**
 * What the written year-end report costs, and what the money buys (IMP-23,
 * D-031).
 *
 * Two reports exist. The **basic** report — the deterministic reading IMP-22
 * assembles from frozen figures — is free and stays free. The PRD's promise is
 * that a co-op says what change it is trying to make and gets a report back at
 * the end of the year; a paywall across that sentence would be a different
 * product. The **written** report is the same frozen figures with prose
 * composed around them, and that is what is sold.
 *
 * **$50 buys a reporting period, not a document** (Charley, 2026-08-27). A
 * co-op that pays for 2026 can regenerate, revise and republish its 2026
 * written report as often as it likes. Charging per generation would make a
 * co-op ration exactly the revisions that make a report honest — the second
 * draft is usually the true one.
 *
 * Mirrored in `apps/web/lib/fees.ts` for the pages that quote the price before
 * checkout, and a test asserts the two agree. A button that says $50 and a
 * Stripe page that says something else is how a co-op stops trusting the
 * invoice.
 */

/** The one-time charge for a written report, in cents. */
export const WRITTEN_REPORT_PRICE_CENTS = 5000;

/** What the co-op sees on the Stripe page and the receipt. */
export const WRITTEN_REPORT_PRODUCT_NAME = 'MaybeOS Impact Report';

/** Marks a Checkout session as this purchase rather than a ticket or a plan. */
export const WRITTEN_REPORT_CHECKOUT_KIND = 'impact_report';

/**
 * Does a purchase entitle a report?
 *
 * Containment rather than an exact date match, deliberately. An admin who
 * nudges the period end by a day, or generates a Q4 reading inside the year
 * they paid for, has not bought a new period — and being generous about that
 * costs less than the support ticket that the strict reading would generate.
 * The loophole it leaves (a year bought, twelve monthly written reports
 * published) is the promise as it was made: the period is what was sold.
 */
export function purchaseCoversPeriod(
  purchase: { periodStart: Date; periodEnd: Date },
  report: { periodStart: Date; periodEnd: Date },
): boolean {
  return (
    purchase.periodStart.getTime() <= report.periodStart.getTime() &&
    purchase.periodEnd.getTime() >= report.periodEnd.getTime()
  );
}
