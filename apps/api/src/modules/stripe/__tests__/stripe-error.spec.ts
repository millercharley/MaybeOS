import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { forMember, isStripeError, memberFacingStripeError } from '../stripe-error';

/**
 * What a member is told when Stripe refuses (2026-10-02).
 *
 * The real one, shown to somebody clicking Join on MaybeItsFate's public
 * page: a live restricted-key fragment, a connected account id, and a link to
 * the Stripe dashboard. The test exists because that leak is invisible in
 * every other way — the request fails, the page renders, nothing is logged as
 * wrong, and the only person who sees the problem is the stranger reading it.
 */

const stripeError = (type: string, message: string) =>
  Object.assign(new Error(message), { type });

const PERMISSION_DENIED = stripeError(
  'StripeInvalidRequestError',
  "Permission denied. The provided key 'rk_live_...W4ie' does not have the required " +
    "permissions for this endpoint on account 'acct_1MhgKwDaRqv0hdwb'. Enabling Products " +
    "Write ('product_write') permissions on this key would allow this request to continue. " +
    'You can edit permissions at https://dashboard.stripe.com/b/acct_1U2yA7D14bhghVE2',
);

describe('recognising a Stripe error', () => {
  it('knows one when it sees it', () => {
    expect(isStripeError(PERMISSION_DENIED)).toBe(true);
  });

  it('leaves everything else alone, so other handling is untouched', () => {
    expect(isStripeError(new Error('the database went away'))).toBe(false);
    expect(isStripeError({ type: 'something-else' })).toBe(false);
    expect(isStripeError(null)).toBe(false);
    expect(memberFacingStripeError(new Error('not stripe'))).toBeNull();
  });
});

describe('what the member is told', () => {
  it('never repeats the key, the account or the dashboard link', () => {
    const shown = memberFacingStripeError(PERMISSION_DENIED)?.message ?? '';

    expect(shown).not.toMatch(/rk_live|sk_live|acct_|dashboard\.stripe\.com|product_write/);
  });

  it('says nothing was charged, because that is the first thing anybody wonders', () => {
    const shown = memberFacingStripeError(PERMISSION_DENIED)?.message ?? '';

    expect(shown).toMatch(/nothing has been charged/i);
  });

  it('points at an organiser rather than blaming the reader', () => {
    const shown = memberFacingStripeError(PERMISSION_DENIED)?.message ?? '';

    expect(shown).toMatch(/organiser/i);
  });

  it('answers 503, so the exception filter reports it to Sentry', () => {
    // A 4xx would be quietly swallowed as somebody's bad request. This is a
    // co-op that cannot take money, and somebody should hear about it.
    expect(memberFacingStripeError(PERMISSION_DENIED)).toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the original as the cause, so the detail survives for us', () => {
    const friendly = memberFacingStripeError(PERMISSION_DENIED);

    expect((friendly as { cause?: unknown }).cause).toBe(PERMISSION_DENIED);
  });
});

describe('a declined card, which is the one Stripe writes for the cardholder', () => {
  const declined = stripeError('StripeCardError', 'Your card has insufficient funds.');

  it('passes the message through, because the member can act on it', () => {
    expect(memberFacingStripeError(declined)?.message).toBe('Your card has insufficient funds.');
  });

  it('answers 400 — a declined card is not MaybeOS being broken', () => {
    expect(memberFacingStripeError(declined)).toBeInstanceOf(BadRequestException);
  });
});

describe('running work on a member’s behalf', () => {
  it('returns the value when nothing goes wrong', async () => {
    await expect(forMember(async () => 'https://checkout.stripe.com/x')).resolves.toBe(
      'https://checkout.stripe.com/x',
    );
  });

  it('reports the real error to whoever is logging, and not to the member', async () => {
    const logged: string[] = [];

    await expect(
      forMember(
        async () => {
          throw PERMISSION_DENIED;
        },
        (err) => logged.push(err.message),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(logged[0]).toContain('rk_live');
  });

  it('lets a non-Stripe failure through untouched', async () => {
    const boom = new Error('the database went away');

    await expect(
      forMember(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
