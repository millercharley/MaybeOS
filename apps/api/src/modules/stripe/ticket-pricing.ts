import { MaybeOsPlan } from '@prisma/client';

/**
 * What a ticket costs and how the money splits (D-013).
 *
 * MaybeOS takes a **flat fee per transaction**, set by the co-op's plan. Not a
 * percentage — D-013 records the numbers verbatim, and a percentage would
 * quietly change what every co-op pays:
 *
 *   FREE       $0/month        + $0.55 per transaction
 *   PLUS       $100 + per-user + $0.30 per transaction
 *   UNLIMITED  $299–349/month  + $0.10 per transaction
 *
 * The co-op may add a fee of its own on top (Charley, 2026-08-12). Both are
 * added to the ticket price rather than taken out of it, so a co-op pricing a
 * ticket at $10 receives $10 — the fees are visible to the buyer as fees, and
 * the co-op is not quietly earning less than the number it published.
 *
 * Everything is integer cents. Money in floats is how a ledger stops adding up.
 */

/** MaybeOS's cut per transaction, in cents, by plan (D-013). */
export const PLATFORM_FEE_CENTS: Record<MaybeOsPlan, number> = {
  FREE: 55,
  PLUS: 30,
  UNLIMITED: 10,
};

/**
 * Stripe refuses a charge under 50 cents (USD). A free event never reaches
 * Stripe, so this only bites on a deliberately tiny ticket price.
 */
export const STRIPE_MINIMUM_CENTS = 50;

export interface TicketBreakdown {
  /** What the co-op set as the ticket price. */
  ticketCents: number;
  /** MaybeOS's cut, by plan. */
  platformFeeCents: number;
  /** The co-op's own additional fee, if it set one. */
  orgFeeCents: number;
  /** What the buyer is charged, all in. */
  totalCents: number;
  /**
   * What Stripe should take as the application fee — MaybeOS's cut only. The
   * co-op's own fee is not MaybeOS's money and must stay in the co-op's
   * account, which is exactly the mistake this field exists to prevent.
   */
  applicationFeeCents: number;
}

export function priceTicket({
  ticketCents,
  plan,
  orgFeeCents = 0,
}: {
  ticketCents: number;
  plan: MaybeOsPlan;
  orgFeeCents?: number;
}): TicketBreakdown {
  if (!Number.isInteger(ticketCents) || ticketCents <= 0) {
    throw new Error('Ticket price must be a positive whole number of cents');
  }
  if (!Number.isInteger(orgFeeCents) || orgFeeCents < 0) {
    throw new Error("The co-op's fee must be a whole number of cents, or zero");
  }

  const platformFeeCents = PLATFORM_FEE_CENTS[plan];

  return {
    ticketCents,
    platformFeeCents,
    orgFeeCents,
    totalCents: ticketCents + platformFeeCents + orgFeeCents,
    applicationFeeCents: platformFeeCents,
  };
}

/**
 * A one-line description of the fees for the buyer.
 *
 * Buyers are entitled to know what the extra is before they pay, and "fees"
 * with no explanation is what makes ticketing platforms disliked. Returns null
 * when there is nothing added, so the UI shows nothing rather than "+$0.00".
 */
export function describeFees(breakdown: TicketBreakdown): string | null {
  const { platformFeeCents, orgFeeCents } = breakdown;
  if (platformFeeCents + orgFeeCents === 0) return null;

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const parts = [`${money(platformFeeCents)} MaybeOS`];
  if (orgFeeCents > 0) parts.push(`${money(orgFeeCents)} venue`);

  return `+ ${money(platformFeeCents + orgFeeCents)} in fees (${parts.join(', ')})`;
}

export interface BookingBreakdown {
  /** The room's rate for the hours booked — the co-op's own price. */
  hireCents: number;
  /** MaybeOS's cut, by plan (D-013). */
  platformFeeCents: number;
  /** What the member is charged, all in. */
  totalCents: number;
  /** Stripe's application fee: MaybeOS's cut only. */
  applicationFeeCents: number;
}

/**
 * What hiring a room costs (SPC-06).
 *
 * The co-op sets an hourly rate and MaybeOS takes the same flat
 * per-transaction fee as a ticket sale — D-013's number for their plan, not a
 * percentage of the hire. A percentage would make MaybeOS's cut of a full-day
 * booking many times its cut of a ticket for no extra work.
 *
 * The fee is added on top, so a co-op charging $45/hour for three hours
 * receives $135. Charging the member $135 and passing on less is the co-op
 * quietly earning under its own published rate.
 *
 * Part-hours are billed pro rata and **rounded up to the cent**, because
 * rounding down means a co-op billing 90 minutes at $45/hour receives
 * $67.49 and wonders where the penny went.
 */
export function priceBooking({
  hourlyRateCents,
  startTime,
  endTime,
  plan,
}: {
  hourlyRateCents: number;
  startTime: Date;
  endTime: Date;
  plan: MaybeOsPlan;
}): BookingBreakdown {
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents <= 0) {
    throw new Error('Hourly rate must be a positive whole number of cents');
  }

  const ms = endTime.getTime() - startTime.getTime();
  if (!(ms > 0)) {
    throw new Error('A booking must end after it starts');
  }

  const hireCents = Math.ceil((ms / 3_600_000) * hourlyRateCents);
  const platformFeeCents = PLATFORM_FEE_CENTS[plan];

  return {
    hireCents,
    platformFeeCents,
    totalCents: hireCents + platformFeeCents,
    applicationFeeCents: platformFeeCents,
  };
}
