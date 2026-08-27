import { readFileSync } from 'fs';
import { join } from 'path';
import { WRITTEN_REPORT_PRICE_CENTS } from '@/lib/fees';

/**
 * The page that quotes $50 and the charge that takes it agree (IMP-23).
 *
 * Same reason as the platform fee: a page saying $50 in front of a Stripe
 * page saying something else is how a co-op stops trusting the invoice. Read
 * from the API source rather than imported, because the web app cannot import
 * from `apps/api` and a comment asking the next person to remember is not a
 * check.
 */
describe('the web and the API agree on what the written report costs', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'api', 'src', 'modules', 'impact', 'report-pricing.ts'),
    'utf8',
  );

  const apiPrice = (() => {
    const m = source.match(/export const WRITTEN_REPORT_PRICE_CENTS = (\d+)/);
    if (!m) throw new Error('WRITTEN_REPORT_PRICE_CENTS not found in the API — did it move?');
    return Number(m[1]);
  })();

  it('quotes the price that is actually charged', () => {
    expect(WRITTEN_REPORT_PRICE_CENTS).toBe(apiPrice);
  });

  it('is $50', () => {
    // Charley, 2026-08-27.
    expect(WRITTEN_REPORT_PRICE_CENTS).toBe(5000);
  });

  it('clears Stripe’s 50-cent minimum by a mile', () => {
    expect(WRITTEN_REPORT_PRICE_CENTS).toBeGreaterThanOrEqual(50);
  });
});
