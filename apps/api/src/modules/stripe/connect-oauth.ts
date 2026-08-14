import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The `state` parameter for Stripe Connect OAuth (PAY-05).
 *
 * This is the security of the whole flow, so it is a separate, tested module
 * rather than three lines inside a service method.
 *
 * Stripe's callback arrives as a **browser redirect with no Authorization
 * header** — the API cannot tell who is returning. `state` is the only thing
 * carrying that. If it were guessable or unverified, two attacks open up:
 *
 *   - an attacker completes OAuth with *their* Stripe account while `state`
 *     names *your* co-op, and every ticket your members buy pays them;
 *   - an attacker links a victim's Stripe account to an org the attacker
 *     controls, and refunds it out.
 *
 * So the state is HMAC-signed with the server's secret, binds the org and the
 * admin who started it, and expires quickly. A tampered or stale state is
 * refused rather than trusted.
 *
 * Signed rather than stored in a table because it needs no server state to be
 * safe, and a row that must be cleaned up is a row that eventually isn't.
 */

/** Ten minutes is longer than the flow takes and shorter than a coffee break. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthState {
  orgId: string;
  /** The admin who started it — so the callback cannot be replayed by another. */
  userId: string;
  /** Milliseconds since epoch. */
  issuedAt: number;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Build a signed state string to hand to Stripe. */
export function encodeState(state: OAuthState, secret: string): string {
  if (!secret) throw new Error('Cannot sign OAuth state without a secret');

  const payload = base64url(JSON.stringify(state));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify and decode a state that came back from Stripe.
 *
 * Returns null for anything not exactly right — bad shape, bad signature,
 * expired. The caller refuses; it never guesses at a partial match.
 */
export function decodeState(
  raw: string | undefined,
  secret: string,
  now: number = Date.now(),
): OAuthState | null {
  if (!raw || !secret) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);

  // Constant-time: a fast reject on the first wrong byte leaks how much of a
  // forged signature was right, which is enough to forge one a byte at a time.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof parsed?.orgId !== 'string' ||
    typeof parsed?.userId !== 'string' ||
    typeof parsed?.issuedAt !== 'number'
  ) {
    return null;
  }

  // Rejects a stale link *and* a clock-skewed or forward-dated one, since a
  // state from the future is not something an honest flow produces.
  const age = now - parsed.issuedAt;
  if (age < 0 || age > STATE_TTL_MS) return null;

  return parsed;
}
