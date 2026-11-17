import type { Offering } from '@/lib/api';

/**
 * The small decisions the teaching screens keep making (TCH-01).
 *
 * Pure, and here rather than in a component, because each of them is a rule
 * rather than a layout: what an unscheduled workshop is called, whether an
 * offering is taking anybody, and how a typed price becomes cents. The first
 * two are read by three screens each and the third is the kind of parsing
 * that is wrong in an interesting way.
 */

/** Stripe will not take a payment under fifty cents, so zero is not a price. */
export const MIN_PRICE_CENTS = 50;

/**
 * A typed price as cents, or `'invalid'`.
 *
 * Not `null` for a bad one: null already means "free", which is a real and
 * different answer, and a parser that returns the same thing for "the member
 * left it blank" and "the member typed 'forty quid'" makes the second one
 * silently free. The caller distinguishes them.
 *
 * Accepts what people actually type — a leading `$`, a comma, spaces — and
 * rounds rather than truncating, so `19.999` is two pounds short of nothing
 * rather than a cent short of the price.
 */
export function priceFromInput(input: string): number | null | 'invalid' {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return 'invalid';

  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(cents) || cents < MIN_PRICE_CENTS) return 'invalid';

  return cents;
}

/** Cents back into something a price field can show. Empty for free. */
export function priceToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/**
 * What an offering costs, in a sentence.
 *
 * Four different things, and the order matters. A teacher's own words beat a
 * number, because "sliding scale, pay what you can" is the answer and `$0.00`
 * is not. Free is said out loud rather than shown as a zero, which reads like
 * a bug. And an offering that is not selling tickets says nothing about a
 * price it is not charging.
 */
export function priceLabel(offering: Offering): string {
  if (offering.priceNote) return offering.priceNote;
  if (offering.payment === 'THROUGH_MAYBEOS' && offering.priceCents) {
    return `$${(offering.priceCents / 100).toFixed(2)}`;
  }
  if (offering.kind === 'PRIVATE_LESSON') return 'Ask about rates';

  return 'Free';
}

/**
 * What to call a workshop with no dates on it.
 *
 * "Gathering interest" rather than "unscheduled", which reads like something
 * went wrong. Charley asked for this state explicitly — "not required if just
 * gathering interest or sign ups" — so it is a thing the product says, not a
 * gap it apologises for.
 */
export function scheduleLabel(offering: Offering): string {
  if (offering.kind === 'PRIVATE_LESSON') return 'Arranged with you';

  const count = offering.sessions?.length ?? 0;
  if (count === 0) return 'Gathering interest';

  return count === 1 ? '1 date' : `${count} dates`;
}

/** Whether somebody can still put their hand up. */
export function isOpen(offering: Offering): boolean {
  return Boolean(offering.isPublished ?? true) && !offering.closedAt;
}

/**
 * What the button under an offering says.
 *
 * A workshop with dates sends somebody to the dates, because that is where
 * RSVPs and tickets already live and re-implementing either here would be a
 * second way to do the same thing. Everything else collects an enquiry.
 */
export function actionLabel(offering: Offering): string {
  if (!isOpen(offering)) return 'No longer taking anybody';
  if (offering.kind === 'PRIVATE_LESSON') return 'Ask about lessons';
  if ((offering.sessions?.length ?? 0) > 0) return 'See the dates';

  return "I'd come to this";
}
