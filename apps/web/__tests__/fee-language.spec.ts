import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The fee is said the same way everywhere (D-040).
 *
 * For a year MaybeOS's own documents disagreed and nobody noticed, because
 * they could not be compared: `ticket-pricing.ts` said a flat fee "per
 * transaction", the public pricing page said "per ticket", and checkout was
 * hardcoded to one seat — so the two readings were the same number and the
 * contradiction had no way to show itself. EVT-47's quantity selector is what
 * made them differ, and the answer had to be chosen rather than looked up.
 *
 * This is the guard against it re-forming. "Per transaction" is retired for
 * tickets: a purchase of four seats pays four fees. Room hire keeps it — a
 * booking is one thing however many hours it covers — and that exception is
 * named here rather than left for a reader to infer.
 */
const ROOT = join(__dirname, '..');

/** Files a co-op or a buyer actually reads a fee claim in. */
const USER_FACING = [
  'app/page.tsx',
  'app/terms/page.tsx',
  'components/landing/pricing-plans.tsx',
  'components/settings/maybeos-plan.tsx',
  'lib/fees.ts',
];

function sources(): Array<[string, string]> {
  return USER_FACING.map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]);
}

describe('how the ticket fee is described', () => {
  it('has the files it claims to check', () => {
    // Guards against the suite passing because a path was renamed — the
    // failure mode of every test that reads files by name.
    for (const [rel, source] of sources()) {
      expect(`${rel}:${source.length > 200}`).toBe(`${rel}:true`);
    }
  });

  /**
   * The retired phrase. It is not wrong about room hire, but no page in this
   * list is about room hire alone — so anywhere it reappears here, it is
   * describing a ticket fee and saying the wrong thing about it.
   */
  it('never calls a ticket fee a per-transaction fee', () => {
    const offenders = sources()
      .filter(([, source]) => /per[\s-]transaction/i.test(source))
      .map(([rel]) => rel);

    expect(offenders).toEqual([]);
  });

  /**
   * "Per sale" and "each sale" are the softer version of the same ambiguity:
   * a four-seat purchase is one sale by any ordinary reading, which is the
   * reading D-040 rejected.
   */
  it('never says per sale, which is the same ambiguity in gentler words', () => {
    const offenders = sources()
      .filter(([, source]) => /(per|each)\s+sale\b/i.test(source))
      .map(([rel]) => rel);

    expect(offenders).toEqual([]);
  });

  /** And the claim is actually made, rather than merely not contradicted. */
  it('says per ticket where it quotes the fee at all', () => {
    const [, pricing] = sources().find(([rel]) => rel.endsWith('pricing-plans.tsx'))!;

    expect(pricing).toMatch(/per ticket/i);
  });

  /**
   * The Terms carry the sentence a buyer would need in a dispute: that four
   * seats pay four fees, and that a booking does not work the same way.
   */
  it('spells out in the Terms that per ticket means per seat', () => {
    const [, terms] = sources().find(([rel]) => rel.endsWith('terms/page.tsx'))!;

    expect(terms).toMatch(/per ticket means per seat/i);
    expect(terms).toMatch(/booking is charged once/i);
  });
});
