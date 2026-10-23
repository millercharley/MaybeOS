import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeEmail } from '../../common/email-address';

/**
 * The signed link that proves somebody paid (EVT-46).
 *
 * A ticket buyer is usually not a member. Annette Neblett bought two seats to
 * *Dog Sees God*, got no email at all, and wrote to ask what to do — and even
 * if she had been emailed, there was nothing to send her: MaybeOS had no page
 * that would show a guest what they had bought. The door list was the only
 * record, and it is behind a session she has no reason to have.
 *
 * So the link carries its own proof, exactly as the unsubscribe link does: an
 * HMAC over the event and the address that bought. No session, no account, no
 * row to clean up.
 *
 * **It names an address, not a ticket.** Checkout is created with
 * `quantity: 1` and no quantity selector, so two seats are two Stripe sessions
 * and two `Ticket` rows — which is what Annette and James Knowles both did.
 * A token per ticket would have given her two links for one arrival and no way
 * to show a doorman she holds two seats. Keyed on the address, one link
 * answers the question she is actually being asked at the door, and it stays
 * right if she buys a third.
 *
 * **No expiry in the token.** The server refuses a pass for an event that has
 * ended, because it knows when the event ended; baking a deadline into the
 * signature would mean a clock disagreement locks somebody out of a show they
 * paid for while they are standing at the door.
 *
 * What a leaked token buys an attacker is the sight of one event's name and
 * one buyer's seat count, and the chance to be turned away at a door where
 * somebody else is holding the same name. It authorises nothing else, ever.
 */
export interface TicketPassToken {
  eventId: string;
  /**
   * Normalised at signing, so the token for `Net.Neb@Gmail.com` and the one
   * for `netneb@gmail.com` are the same token and count the same seats.
   * Stripe returns whatever the buyer typed, and it varies between two
   * checkouts by the same person twenty-four seconds apart.
   */
  email: string;
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeTicketPass(token: TicketPassToken, secret: string): string {
  if (!secret) throw new Error('Cannot sign a ticket pass without a secret');

  const email = normalizeEmail(token.email);
  if (!email) throw new Error('Cannot sign a ticket pass without an address');
  if (!token.eventId) throw new Error('Cannot sign a ticket pass without an event');

  const payload = base64url(JSON.stringify({ eventId: token.eventId, email }));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a pass token.
 *
 * Returns null for anything not exactly right, and the caller shows one
 * answer for every kind of wrong — a forged signature, a deleted event and a
 * refunded ticket must look identical from outside, or the page becomes a way
 * to ask whether a guessed token named a real sale.
 */
export function decodeTicketPass(
  raw: string | undefined,
  secret: string,
): TicketPassToken | null {
  if (!raw || !secret) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);

  // Constant-time, for the reason unsubscribe-token.ts spells out: a fast
  // reject on the first wrong byte leaks how much of a forgery was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: TicketPassToken;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed?.eventId !== 'string' || !parsed.eventId) return null;
  if (typeof parsed?.email !== 'string' || !parsed.email) return null;

  // Re-normalised on the way out as well as in. A token is only ever produced
  // by `encodeTicketPass`, so this changes nothing today — but the value is
  // about to be used as a lookup key, and a signature proves a payload was not
  // tampered with, not that it was built by the code we think built it.
  const email = normalizeEmail(parsed.email);
  if (!email) return null;

  return { eventId: parsed.eventId, email };
}
