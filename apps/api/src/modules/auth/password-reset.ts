import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Forgetting a password, and getting back in (AUTH-09).
 *
 * Charley, 2026-11-14: "Add a button for a member to reset their password on
 * the login screen. Provide the full path of sending a confirmation email,
 * that links to a form to create a new password."
 *
 * It was the one gap `sendMagicLink` already named out loud: "With no password
 * reset either, that made a forgotten password unrecoverable." A sign-in link
 * was the whole answer, which works — and asks somebody who knows perfectly
 * well they have a password to go and do something else instead.
 *
 * The rules live here, pure, because every one of them is a security decision
 * and none of them needs a database to test.
 *
 * **A reset token is not a magic-link token, and gets its own column.** They
 * are tempting to share — same shape, same expiry mechanics, both already on
 * `User`. Sharing them would mean a token issued to *sign in* could be
 * redeemed at the *set a password* form and the other way round, which is a
 * token doing a job it was not issued for. It would also mean asking for a
 * sign-in link silently cancelled a reset somebody was halfway through, and
 * that bug would look like the email never arrived.
 *
 * **Stored as a hash, which the magic-link token is not.** This is the one
 * place the two deliberately differ, so it is worth saying why rather than
 * leaving the inconsistency to be tidied by somebody who does not know.
 * Everything else on `User` that grants access is either a bcrypt hash or a
 * fifteen-minute session. A reset token is the only credential in the system
 * that turns a *read* of one database column into a permanent change of
 * somebody's password — so what is written down is a sha256 and what is
 * emailed is the only copy of the token. A sha256 is right here and would be
 * wrong on a password: there is no salt because there is nothing to guess,
 * 32 random bytes being far past any dictionary.
 *
 * The magic-link token has a similar problem and predates this; moving it is
 * a change to the sign-in path that 433 of MaybeItsFate's members depend on,
 * which is not something to slip into a password-reset feature.
 */

/**
 * An hour, where a sign-in link gets fifteen minutes.
 *
 * Different jobs, different patience. A sign-in link is pressed by somebody
 * sitting at the screen that asked for it. A password reset is read later, on
 * a phone, often after looking for the email — and a member who finds a dead
 * link has to start again without being told why it died. An hour is long
 * enough to be found and short enough that a forwarded or logged email stops
 * mattering the same afternoon.
 */
export const RESET_WINDOW_MINUTES = 60;

/** The floor the DTO enforces too. Length is what resists an offline attack. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * What goes in the email, and what goes in the database.
 *
 * 32 bytes rather than a uuid: a uuid v4 carries 122 bits of randomness and
 * would do, but it also *looks* like the magic-link token, and two different
 * credentials that look alike get confused by people reading logs. base64url
 * so it survives a query string with no encoding, and so no mail client
 * decides a trailing `=` is not part of the link.
 */
export function newResetToken(now: Date = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token), expiresAt: resetExpiry(now) };
}

/** What is safe to write down. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_WINDOW_MINUTES * 60 * 1000);
}

/**
 * Whether a token someone presented is the one that was issued.
 *
 * Compared with `timingSafeEqual` rather than `===`. The database lookup is by
 * hash and would be a constant-time-ish index probe anyway, so this is belt
 * and braces — but it costs one line, and the alternative is an argument about
 * whether Postgres leaks timing, which is not an argument worth having about a
 * password reset.
 *
 * Length is checked first because `timingSafeEqual` throws on a mismatch, and
 * a thrown comparison inside a verification path is how a refusal turns into a
 * 500 that behaves differently from a real one.
 */
export function resetTokenMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashResetToken(presented), 'hex');
  const b = Buffer.from(storedHash ?? '', 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Whether a stored reset is still live. Absent expiry counts as expired. */
export function resetIsLive(expiry: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(expiry) && (expiry as Date).getTime() > now.getTime();
}

/**
 * Where the web app puts the form.
 *
 * The same shape as `magicLinkUrl` and for the same reasons: `WEB_URL` doubles
 * as the CORS allowlist so it may hold several comma-separated origins, the
 * first is canonical, and a trailing slash produces `//reset-password`, which
 * routes and looks broken in an email client's link preview.
 */
export function passwordResetUrl(configured: string | undefined, token: string): string {
  const base = (configured || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
  return `${base}/reset-password/new?token=${encodeURIComponent(token)}`;
}

/**
 * What the request endpoint says, always.
 *
 * One sentence for an address with an account and an address without one.
 * `sendMagicLink` already holds this line — an endpoint that answers
 * differently is a way to ask MaybeOS who its members are, and a co-op's
 * membership list is exactly the thing not to publish.
 */
export const RESET_REQUESTED_MESSAGE =
  'If that address has an account, a link to set a new password is on its way.';
