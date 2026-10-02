import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The signed token in a one-click unsubscribe link (RDR-01).
 *
 * An unsubscribe link is followed from an email client, by somebody who is
 * not signed in and should not have to be: asking a member to log in before
 * they can stop email is how an unsubscribe becomes a complaint instead. So
 * the link carries its own proof — an HMAC over the membership and what is
 * being switched off.
 *
 * Signed rather than stored in a table, for the reason `oauth-state.ts` gives:
 * a signed value needs no server state to be safe, and a row that must be
 * cleaned up is a row that eventually isn't. Unlike that one, this has **no
 * expiry** — a link in a two-year-old email must still work, because the
 * alternative is a member who cannot leave.
 *
 * What a leaked token buys an attacker is the ability to unsubscribe somebody
 * from one kind of email in one co-op. That is why the token is scoped by
 * `purpose` and why nothing else is ever authorised by it: it must never grow
 * into a general-purpose session.
 */

export interface UnsubscribeToken {
  /** The membership, not the user: one co-op's email is not another's. */
  userOrgId: string;
  /** What is being switched off. A token for one never works for another. */
  purpose: 'radar';
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeUnsubscribe(token: UnsubscribeToken, secret: string): string {
  if (!secret) throw new Error('Cannot sign an unsubscribe link without a secret');

  const payload = base64url(JSON.stringify(token));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a token from an unsubscribe link.
 *
 * Returns null for anything not exactly right. The caller shows a page saying
 * the link did not work rather than guessing whose membership was meant —
 * unsubscribing the wrong member is worse than failing to unsubscribe.
 */
export function decodeUnsubscribe(
  raw: string | undefined,
  secret: string,
): UnsubscribeToken | null {
  if (!raw || !secret) return null;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);

  // Constant-time, for the reason oauth-state.ts spells out: a fast reject on
  // the first wrong byte leaks how much of a forged signature was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: UnsubscribeToken;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed?.userOrgId !== 'string' || parsed?.purpose !== 'radar') return null;

  return parsed;
}
