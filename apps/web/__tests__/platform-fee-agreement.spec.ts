import { readFileSync } from 'fs';
import { join } from 'path';
import { PLATFORM_FEE_CENTS } from '@/lib/fees';

/**
 * The web and the API charge the same fee.
 *
 * These numbers exist twice by necessity — the API computes the real charge
 * and Stripe's application fee, and the web quotes the total *before* a buyer
 * is sent to Stripe, because a button saying $10.00 in front of a Stripe page
 * saying $11.00 is how a co-op gets accused of hiding fees.
 *
 * Twice is unavoidable. **Four times was not**: repricing on 2026-08-21 found
 * the table copied privately into the event form and the payouts panel as
 * well, each with its own `?? 55` fallback. Changing the price would have
 * moved the checkout and left the organiser setting the ticket price reading
 * the old figure — the writer and the reader disagreeing, which is exactly
 * what IMP-04 was.
 *
 * Read from the API source rather than imported, because the web app cannot
 * import from `apps/api` and a comment asking the next person to remember is
 * not a check.
 */
describe('the web and the API agree on MaybeOS’s cut', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'api', 'src', 'modules', 'stripe', 'ticket-pricing.ts'),
    'utf8',
  );

  const apiTable = (() => {
    const block = source.match(
      /export const PLATFORM_FEE_CENTS: Record<MaybeOsPlan, number> = \{([^}]*)\}/,
    );
    if (!block) throw new Error('PLATFORM_FEE_CENTS not found in the API — did it move?');

    return Object.fromEntries(
      [...block[1].matchAll(/(\w+)\s*:\s*(\d+)/g)].map(([, plan, cents]) => [plan, Number(cents)]),
    );
  })();

  it('matches plan for plan', () => {
    expect(PLATFORM_FEE_CENTS).toEqual(apiTable);
  });

  it('covers every plan the API knows about', () => {
    // A plan missing here falls back to FREE, which overcharges a paying
    // co-op's buyers rather than failing loudly.
    for (const plan of Object.keys(apiTable)) {
      expect(PLATFORM_FEE_CENTS[plan]).toBeDefined();
    }
  });

  it('charges the free plan most per transaction', () => {
    // The two halves of the pricing work in opposite directions on purpose:
    // paying nothing up front costs most per ticket, which is what lets
    // "upfront cost should never block a community" be true.
    expect(PLATFORM_FEE_CENTS.FREE).toBeGreaterThan(PLATFORM_FEE_CENTS.PLUS);
    expect(PLATFORM_FEE_CENTS.PLUS).toBeGreaterThan(PLATFORM_FEE_CENTS.UNLIMITED);
  });

  it('is the numbers on the published pricing table', () => {
    // Charley's live Stripe pricing table, 2026-08-21.
    expect(PLATFORM_FEE_CENTS).toEqual({ FREE: 100, PLUS: 30, UNLIMITED: 10 });
  });
});
