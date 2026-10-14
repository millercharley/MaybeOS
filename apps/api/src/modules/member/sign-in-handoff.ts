/**
 * A sign-in link an organiser hands over by hand (MEM-29).
 *
 * **Why this exists.** Microsoft accepts MaybeOS mail with a clean `250` and
 * then suppresses it: Postmark reports `Delivered`, and the member finds
 * nothing in their inbox and nothing in junk. Every member on Outlook,
 * Hotmail, Live, and some Microsoft 365 tenants is therefore unreachable by
 * email — and a magic link is email. The fixes for that are real (a named
 * sender, a text part, DMARC, a separate bulk stream) and none of them land
 * this week, because sender reputation recovers over weeks.
 *
 * So there has to be a way in that is not email. An organiser mints the link
 * and reads it out, texts it, or hands it over in the building.
 *
 * **What it costs.** The link signs its holder in as that member, so an
 * organiser holding one can act as them. That is worth saying plainly. It is
 * not, however, a new power: an admin can already change a member's email
 * address and send a sign-in link to an address they control. This makes the
 * same capability explicit, deliberate, and written down in the co-op's own
 * audit log, which the laundered version is not.
 */

/**
 * The longest a hand-delivered link stays live.
 *
 * An emailed link is governed by the co-op's `inviteExpiryDays`, which a
 * co-op may set generously because the link only ever sits in the member's
 * own mailbox. This one passes through an organiser's hands and very likely
 * an SMS thread, where it stays readable to anyone who picks up the phone, so
 * it takes the shorter of the two rather than inheriting a long window that
 * was chosen for a safer channel.
 */
export const HANDOFF_MAX_DAYS = 7;

/** When a link minted now should stop working. */
export function handoffExpiry(now: Date, inviteExpiryDays: number): Date {
  // A co-op that has not set this, or has set nonsense, still gets a window
  // that ends: `NaN` days would produce an Invalid Date, which compares false
  // against everything and so never expires.
  const configured = Number.isFinite(inviteExpiryDays) ? inviteExpiryDays : HANDOFF_MAX_DAYS;
  const days = Math.min(Math.max(configured, 1), HANDOFF_MAX_DAYS);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The address the member opens. One place, so the audit and the UI agree. */
export function handoffUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/+$/, '')}/magic-link?token=${encodeURIComponent(token)}`;
}

/** The action name in the co-op's audit log. */
export const SIGN_IN_HANDOFF_ACTION = 'member.sign_in_link.created';
