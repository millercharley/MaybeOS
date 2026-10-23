import { api } from '@/lib/api';

/**
 * What the door pass page is showing, and why (EVT-46).
 *
 * The page itself is a card with a number on it. The part worth testing is
 * the decision underneath, and this app's harness renders no components —
 * every spec in `__tests__` exercises a function or scans a file. A state
 * machine written inside the component is a state machine nothing can call,
 * which is how `safePath()` reached production with a bug only a live Sentry
 * trace found (OPS-10). Same reasoning as `radar-unsubscribe.ts`, same shape.
 */

export interface TicketPass {
  event: {
    title: string;
    /** Already in the event's own timezone — the API formats it, not us. */
    when: string;
    where: string | null;
    orgName: string;
    canceled: boolean;
    past: boolean;
  };
  holder: { name: string | null; email: string };
  seats: number;
  boughtAt: string | null;
}

export type PassState =
  | { kind: 'loading' }
  | { kind: 'ready'; pass: TicketPass }
  /** No token on the address, or one the API would not accept. */
  | { kind: 'badLink' }
  /** The request got no answer at all — worth offering another go. */
  | { kind: 'failed' };

/**
 * Is this shape actually a pass?
 *
 * Validated field by field because it comes off the network, and because the
 * API answers `{ ok: false }` for every kind of refusal — a forged token, a
 * deleted event, a buyer who was refunded. One answer for all of them is
 * deliberate on that side; this is the other half of it, and it must not
 * mistake the refusal for a pass with missing fields.
 */
export function isPass(value: unknown): value is TicketPass {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  const event = v.event as Record<string, unknown> | undefined;
  const holder = v.holder as Record<string, unknown> | undefined;

  if (typeof event !== 'object' || event === null) return false;
  if (typeof holder !== 'object' || holder === null) return false;
  if (typeof event.title !== 'string' || typeof event.when !== 'string') return false;
  if (typeof holder.email !== 'string') return false;

  // A pass with no seats on it is not a pass. The API never sends one — it
  // returns the refusal instead — so this is a guard against a future change
  // on that side rather than against anything today.
  return typeof v.seats === 'number' && v.seats > 0;
}

/**
 * Where the page starts.
 *
 * A link copied out of an email by hand loses its query string often enough
 * to deserve its own state, as the unsubscribe page found: there is nothing
 * to fetch, so say so on arrival rather than after a round trip that was
 * never going to succeed.
 */
export function initialPassState(token: string | null | undefined): PassState {
  return token ? { kind: 'loading' } : { kind: 'badLink' };
}

export async function loadPass(token: string | null | undefined): Promise<PassState> {
  if (!token) return { kind: 'badLink' };

  try {
    const reply = await api.tickets.pass(token);
    return isPass(reply) ? { kind: 'ready', pass: reply } : { kind: 'badLink' };
  } catch {
    // The network, not the token. Distinguished because the two deserve
    // different pages: one offers a retry, the other does not, and a doorman
    // watching somebody tap "try again" on a forged link is the worse of the
    // two mistakes.
    return { kind: 'failed' };
  }
}

/**
 * What the big line on the pass says.
 *
 * Seats are counted rather than stored, because Checkout has no quantity
 * selector — so this is also the sentence that has to make sense to somebody
 * who bought twice in half a minute and is now holding one link.
 */
export function seatLine(seats: number): string {
  return `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
}

/**
 * The line under the event, or null when there is nothing worth saying.
 *
 * A pass is read at a door, in the dark, by somebody in a queue. A cancelled
 * show and a show that already happened are the two facts that change what
 * the person holding it should do, and everything else is noise.
 */
export function passNotice(event: TicketPass['event']): string | null {
  if (event.canceled) {
    return 'This event has been cancelled. Your refund goes back to the card you paid with.';
  }
  if (event.past) return 'This event has already happened.';
  return null;
}
