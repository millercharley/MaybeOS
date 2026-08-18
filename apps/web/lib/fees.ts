/**
 * What a ticket costs a buyer, and where the money goes (D-013).
 *
 * Mirrors `apps/api/src/modules/stripe/ticket-pricing.ts`, which is the
 * authority — the API computes the real charge and the application fee, and
 * this exists so the buyer sees the same number *before* they are sent to
 * Stripe. A button that says $10.00 and a Stripe page that says $10.55 is how
 * a co-op gets accused of hiding fees.
 *
 * Fees are added on top rather than taken out, so a co-op pricing a ticket at
 * $10 receives $10 and the buyer sees the extra named.
 */
export const PLATFORM_FEE_CENTS: Record<string, number> = {
  FREE: 55,
  PLUS: 30,
  UNLIMITED: 10,
};

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
