import { MaybeOsPlan } from '@prisma/client';

/**
 * What a ticket costs and how the money splits (D-013).
 *
 * MaybeOS takes a **flat fee per transaction**, set by the co-op's plan. Not a
 * percentage — the numbers are set deliberately, and a percentage would
 * quietly change what every co-op pays as ticket prices move.
 *
 * Repriced by Charley on 2026-08-21, from the live pricing table:
 *
 *   FREE       $0                              + $1.00 per transaction
 *   PLUS       $0.50/member/mo · $3.65/member/yr + $0.30 per transaction
 *   UNLIMITED  $349/mo · $299/mo billed yearly   + $0.10 per transaction
 *
 * The subscription half and the per-transaction half work in opposite
 * directions on purpose: a co-op that pays nothing up front pays most per
 * ticket, which is what lets "upfront cost should never block a community"
 * be true without MaybeOS earning nothing from the co-ops that use it most.
 * **The $100 initiation fee is gone** (Charley, 2026-08-21).
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
  FREE: 100,
  PLUS: 30,
  UNLIMITED: 10,
};

/**
 * Stripe refuses a charge under 50 cents (USD). A free event never reaches
 * Stripe, so this only bites on a deliberately tiny ticket price.
 */
export const STRIPE_MINIMUM_CENTS = 50;

/**
 * The most seats one person may buy at once (EVT-47).
 *
 * A limit rather than none, because the box is typed into by the public and
 * the number goes straight into a charge: a slip on the keyboard should cost
 * somebody a correction, not four hundred dollars. Ten is above any party
 * anybody has brought to a MaybeItsFate event and below the point where a
 * mistake is painful.
 *
 * It is not a capacity rule. Capacity is the event's own, checked separately
 * and against seats already sold.
 */
export const MAX_SEATS_PER_PURCHASE = 10;

export interface TicketBreakdown {
  /** How many seats this purchase is for (EVT-47). */
  quantity: number;
  /** What the co-op set as the ticket price — **per seat**. */
  ticketCents: number;
  /** MaybeOS's cut, per seat, by plan. */
  platformFeeCents: number;
  /** The co-op's own additional fee, per seat, if it set one. */
  orgFeeCents: number;
  /** One seat, all in. What Stripe is given as the unit amount. */
  unitTotalCents: number;
  /** What the buyer is charged for the whole purchase. */
  totalCents: number;
  /**
   * What Stripe should take as the application fee — MaybeOS's cut only, for
   * every seat in this purchase. The co-op's own fee is not MaybeOS's money
   * and must stay in the co-op's account, which is exactly the mistake this
   * field exists to prevent.
   */
  applicationFeeCents: number;
}

export function priceTicket({
  ticketCents,
  plan,
  orgFeeCents = 0,
  quantity = 1,
}: {
  ticketCents: number;
  plan: MaybeOsPlan;
  orgFeeCents?: number;
  /**
   * Seats. Defaults to one, so every caller written before EVT-47 means
   * exactly what it meant before.
   */
  quantity?: number;
}): TicketBreakdown {
  if (!Number.isInteger(ticketCents) || ticketCents <= 0) {
    throw new Error('Ticket price must be a positive whole number of cents');
  }
  if (!Number.isInteger(orgFeeCents) || orgFeeCents < 0) {
    throw new Error("The co-op's fee must be a whole number of cents, or zero");
  }
  /*
    Checked here rather than only at the edge, because this function is what
    decides how much somebody is charged. A DTO validates the request; this
    refuses to produce a price for a quantity nobody should be able to buy,
    whatever route reaches it.
  */
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SEATS_PER_PURCHASE) {
    throw new Error(`Seats must be a whole number from 1 to ${MAX_SEATS_PER_PURCHASE}`);
  }

  const platformFeeCents = PLATFORM_FEE_CENTS[plan];
  const unitTotalCents = ticketCents + platformFeeCents + orgFeeCents;

  return {
    quantity,
    ticketCents,
    platformFeeCents,
    orgFeeCents,
    unitTotalCents,
    totalCents: unitTotalCents * quantity,
    /*
      Per seat, multiplied — not charged once per purchase.

      This is the one place EVT-47 had to choose, because until there was a
      quantity selector the two readings were the same number and MaybeOS's
      own documents disagree about which it is. `D-013` says "a flat fee per
      **transaction**"; the public pricing page says "a flat fee per
      **ticket**", and that is the sentence co-ops signed up against and
      buyers read before paying.

      Per seat also matches what has actually been charged: with no selector,
      two seats meant two checkouts, so Annette Neblett paid MaybeOS twice.
      Keeping it per seat means the selector changes how many times she has
      to type her card in, and nothing about what anybody is paid.
    */
    applicationFeeCents: platformFeeCents * quantity,
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
  const { platformFeeCents, orgFeeCents, quantity = 1 } = breakdown;
  if (platformFeeCents + orgFeeCents === 0) return null;

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  // Said per seat, and the breakdown stays per seat with it. Multiplying the
  // total while leaving "($1.00 MaybeOS, $0.75 venue)" beside it reads as an
  // arithmetic error to the one person guaranteed to check it: the buyer.
  const each = quantity > 1 ? ' each' : '';
  const parts = [`${money(platformFeeCents)} MaybeOS`];
  if (orgFeeCents > 0) parts.push(`${money(orgFeeCents)} venue`);

  return `+ ${money(platformFeeCents + orgFeeCents)} in fees${each} (${parts.join(', ')})`;
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
