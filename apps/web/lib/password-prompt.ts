/**
 * Offering a password to somebody who just arrived on a link (AUTH-05).
 *
 * AUTH-04 made it possible to create one; this is what makes it likely.
 * Profile settings only helps people who already suspect the option is
 * there, and 433 of MaybeItsFate's 439 members sign in with a link — so
 * practically the whole co-op would have had to go looking for something
 * they had no reason to think existed.
 *
 * The moment after a sign-in link is when the trade is obvious: they have
 * just been to their inbox to get in. So the offer is made there and then,
 * once, and taken away for good the first time it is declined.
 *
 * **Never blocking.** A sign-in link is a complete way to use MaybeOS, not a
 * lesser one to be nagged out of.
 */

const STORED = 'maybeos.password-prompt';

export type PromptState = 'offer' | 'dismissed' | 'none';

export function readPrompt(): PromptState {
  if (typeof window === 'undefined') return 'none';
  try {
    const saved = window.localStorage.getItem(STORED);
    return saved === 'offer' || saved === 'dismissed' ? saved : 'none';
  } catch {
    // Private windows and blocked storage both throw. An offer is not worth
    // a crash on every page of the product.
    return 'none';
  }
}

/**
 * Raise it after a sign-in link, unless it has already been declined.
 *
 * Declining is permanent, so a member who signs in by link every week is
 * asked exactly once rather than every week — which is the difference
 * between an offer and a nag.
 */
export function offerPassword(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(STORED) === 'dismissed') return;
    window.localStorage.setItem(STORED, 'offer');
  } catch {
    // Nothing to do. The profile screen still carries the same offer.
  }
}

/** Taken, or declined. Either way there is nothing left to ask. */
export function settlePrompt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORED, 'dismissed');
  } catch {
    // See above.
  }
}
