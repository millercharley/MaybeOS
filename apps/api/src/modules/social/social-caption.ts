/**
 * Instagram's caption limit, and the rules for an Instagram username.
 *
 * This file used to build the words that went out with a host's shared event
 * (SOC-01). SOC-04 removed member sharing — in the two months it existed not
 * one member used it — and took those builders with it. What is left is what
 * was never about member sharing: Instagram's own limits and its username
 * grammar, which the co-op's weekly post needs exactly as much.
 */

/** Instagram's caption limit. Facebook allows far more, so this is the binding one. */
export const CAPTION_LIMIT = 2200;

/** Instagram usernames: letters, digits, periods and underscores, up to 30. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/** A username as a member typed it, with or without the @, or null if it is not one. */
export function normaliseHandle(value: string | null | undefined): string | null {
  const handle = (value ?? '').trim().replace(/^@/, '');
  if (!handle) return null;
  return HANDLE.test(handle) && !handle.startsWith('.') && !handle.endsWith('.') ? handle.toLowerCase() : null;
}
