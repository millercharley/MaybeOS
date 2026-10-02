import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * What a member is told when Stripe refuses (2026-10-02).
 *
 * A prospective member clicked Join and was shown this, on MaybeItsFate's
 * public page:
 *
 * > Permission denied. The provided key 'rk_live_…W4ie' does not have the
 * > required permissions for this endpoint on account 'acct_1MhgKw…'.
 * > Enabling Products Write … You can edit permissions at
 * > https://dashboard.stripe.com/b/acct_…
 *
 * Three things wrong with that, in order of seriousness. It hands a stranger
 * a key fragment, a connected account id and a dashboard link — internal
 * configuration, on a page anybody can open. It blames the reader for
 * something only an organiser can fix. And it is unreadable, so even an
 * organiser seeing it learns "something is broken" rather than what.
 *
 * **Card errors are the exception, and they pass through.** Stripe writes
 * those for the cardholder — "Your card was declined", "Your card has
 * insufficient funds" — and they are the one class of Stripe message a member
 * can actually act on. Everything else is written for whoever built the
 * integration, and belongs in the logs and in Sentry, where this sends it by
 * throwing a 5xx the exception filter reports.
 */

export function isStripeError(err: unknown): err is Stripe.errors.StripeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof (err as { type?: unknown }).type === 'string' &&
    (err as { type: string }).type.startsWith('Stripe')
  );
}

/**
 * A member-facing exception for a Stripe failure, or null when the error is
 * not Stripe's — those keep whatever handling the caller already had.
 *
 * The generic message says the three things somebody in this position needs:
 * nothing was charged, it is not their fault, and who can fix it.
 */
export function memberFacingStripeError(err: unknown): HttpException | null {
  if (!isStripeError(err)) return null;

  // Written by Stripe for the person holding the card. `cause` carries the
  // original either way, so the logs and Sentry keep every detail the member
  // must not see.
  if (err.type === 'StripeCardError') {
    return new BadRequestException(err.message, { cause: err });
  }

  return new ServiceUnavailableException(
    'Payments are not working just now, and nothing has been charged. ' +
      'Please try again in a few minutes — if it keeps happening, let an organiser know.',
    { cause: err },
  );
}

/** Run something that talks to Stripe on a member's behalf. */
export async function forMember<T>(
  work: () => Promise<T>,
  onStripeFailure?: (err: Stripe.errors.StripeError) => void,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const friendly = memberFacingStripeError(err);
    if (!friendly) throw err;

    if (isStripeError(err)) onStripeFailure?.(err);
    throw friendly;
  }
}
