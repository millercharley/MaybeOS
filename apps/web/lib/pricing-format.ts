import type { PublicPlan } from '@/lib/api';

/**
 * Turning the prices the API reads from Stripe into words (WEB-02).
 *
 * No amount is written here or on the landing page. Everything is computed
 * from the figures the server returns, which is what keeps the page from
 * drifting when a price changes (MKT-02).
 */

export type Interval = 'month' | 'year';

/** Whole dollars without cents, anything else with them, and always with them when `cents` is set. */
export function money(cents: number, { cents: forceCents = false }: { cents?: boolean } = {}): string {
  const dollars = cents / 100;
  const whole = cents % 100 === 0 && !forceCents;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

export interface PlanFigures {
  amount: string;
  unit: string;
  /** A second line under the price, or null. */
  note: string | null;
  fee: string;
  /** The fee added to each dues payment, or null when the plan adds none. */
  duesFee: string | null;
  /** "Up to N members", or null when there is no limit. */
  memberLimit: string | null;
}

/** Null when the price for that interval is unknown, so the page never guesses. */
export function planFigures(plan: PublicPlan, interval: Interval): PlanFigures | null {
  const cents = interval === 'month' ? plan.monthlyCents : plan.yearlyCents;
  if (cents === null) return null;

  const per = plan.perMember ? 'per member ' : '';
  const unit = `${per}a ${interval}`;
  const fee = money(plan.transactionFeeCents, { cents: true });

  let note: string | null = null;
  if (interval === 'year' && plan.monthlyCents && cents > 0) {
    const saving = Math.round(((plan.monthlyCents * 12 - cents) / (plan.monthlyCents * 12)) * 100);
    const perMonth = Math.round(cents / 12);
    const equivalent = plan.perMember
      ? `About ${money(perMonth, { cents: true })} per member a month`
      : `${money(perMonth)} a month, billed yearly`;
    note = saving > 0 ? `${equivalent}. Save ${saving}%.` : `${equivalent}.`;
  }

  return {
    amount: money(cents),
    unit,
    note,
    fee,
    duesFee: plan.duesFeeCents > 0 ? money(plan.duesFeeCents, { cents: true }) : null,
    memberLimit: plan.memberLimit ? `Up to ${plan.memberLimit.toLocaleString('en-US')} members` : null,
  };
}

/** The largest yearly saving across plans, for the toggle's label. */
export function bestYearlySaving(plans: PublicPlan[]): number {
  return plans.reduce((best, p) => {
    if (!p.monthlyCents || !p.yearlyCents) return best;
    return Math.max(best, Math.round(((p.monthlyCents * 12 - p.yearlyCents) / (p.monthlyCents * 12)) * 100));
  }, 0);
}
