/**
 * What a ticket costs a buyer, and where the money goes (D-013).
 *
 * Mirrors `apps/api/src/modules/stripe/ticket-pricing.ts`, which is the
 * authority — the API computes the real charge and the application fee, and
 * this exists so the buyer sees the same number *before* they are sent to
 * Stripe. A button that says $10.00 and a Stripe page that says $11.00 is how
 * a co-op gets accused of hiding fees.
 *
 * Fees are added on top rather than taken out, so a co-op pricing a ticket at
 * $10 receives $10 and the buyer sees the extra named.
 *
 * **The only copy of these numbers in the web app.** There were three: this
 * one, and a private duplicate inside the event form and the payouts panel,
 * each with its own `?? 55` fallback. Repricing FREE would have changed the
 * checkout and left the event form quoting the old figure to the organiser
 * setting the price — the writer and the reader disagreeing, which is what
 * IMP-04 was. A test now asserts this file and the API agree.
 */
export const PLATFORM_FEE_CENTS: Record<string, number> = {
  FREE: 100,
  PLUS: 30,
  UNLIMITED: 10,
};

/** What a co-op pays MaybeOS, for the pages that explain the choice. */
export const PLAN_PRICING = {
  FREE: { monthlyCents: 0, yearlyCents: 0, label: 'MaybeOS Free' },
  PLUS: { perMemberMonthlyCents: 50, perMemberYearlyCents: 365, label: 'MaybeOS Plus' },
  UNLIMITED: { monthlyCents: 34900, yearlyMonthlyCents: 29900, label: 'MaybeOS Unlimited' },
} as const;

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export interface TicketCost {
  ticketCents: number;
  platformFeeCents: number;
  orgFeeCents: number;
  totalCents: number;
}

export function ticketCost({
  ticketCents,
  plan = 'FREE',
  orgFeeCents = 0,
}: {
  ticketCents: number;
  plan?: string;
  orgFeeCents?: number;
}): TicketCost {
  const platformFeeCents = PLATFORM_FEE_CENTS[plan] ?? PLATFORM_FEE_CENTS.FREE;
  return {
    ticketCents,
    platformFeeCents,
    orgFeeCents,
    totalCents: ticketCents + platformFeeCents + orgFeeCents,
  };
}

/** One line naming the extra, or null when there is none to name. */
export function describeFees(cost: TicketCost): string | null {
  const extra = cost.platformFeeCents + cost.orgFeeCents;
  if (extra === 0) return null;

  const parts = [`${money(cost.platformFeeCents)} MaybeOS`];
  if (cost.orgFeeCents > 0) parts.push(`${money(cost.orgFeeCents)} venue`);
  return `includes ${money(extra)} in fees (${parts.join(', ')})`;
}
