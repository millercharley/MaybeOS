import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The landing page is a page of promises, and every one of them is testable.
 *
 * Two ways it has gone wrong. **MKT-02**: a $19.50 tier advertised itself as
 * "$20" on the page that persuades people to join, while Stripe charged
 * $19.50 — prose quoting a number, drifting from the number. And on
 * 2026-08-20 repricing FREE from $0.55 to $1.00 silently made *"a flat few
 * cents per transaction"* false for the plan every co-op starts on. Nothing
 * failed; the sentence simply stopped being true.
 *
 * So the rule this enforces is narrow and mechanical: **the landing copy does
 * not quote amounts.** It may promise the *shape* of the pricing — flat, not
 * a percentage — which is the actual differentiator and does not move when a
 * price does. Anyone who wants the figures reads the pricing table, which is
 * generated from Stripe and cannot drift from it.
 */
describe('the landing page', () => {
  const source = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf8');

  /** Just the marketing prose, not class names or code. */
  const copy = [...source.matchAll(/'([^']{40,})'/g)].map((m) => m[1]).join('\n');

  it('has copy to check', () => {
    expect(copy.length).toBeGreaterThan(200);
  });

  it('quotes no per-transaction amount', () => {
    // "a flat few cents" was true until it wasn't. A number here is a number
    // that has to be remembered on every repricing.
    expect(copy).not.toMatch(/few cents/i);
    expect(copy).not.toMatch(/\$\d+(\.\d+)?\s*(per|a)\s*(transaction|ticket|sale)/i);
    expect(copy).not.toMatch(/\d+\s*cents?\s*(per|a)\s*(transaction|ticket|sale)/i);
  });

  it('still promises flat rather than a percentage', () => {
    // The thing worth saying, and the only pricing claim that survives a
    // price change.
    expect(copy).toMatch(/flat/i);
    expect(copy).toMatch(/never a percentage/i);
  });

  it('does not promise an export it does not have', () => {
    // IMP-24. D-021 deleted the CSV deliberately: §10 says individual
    // responses are never exposed, and the export returned respondents' names
    // and email addresses beside their answers. The page promised it anyway
    // for weeks. What ImpactOS actually produces is a published report.
    expect(copy).not.toMatch(/\bexport\b/i);
    expect(copy).toMatch(/impact report/i);
    expect(copy).toMatch(/publish/i);
  });

  it('says that individual answers stay private', () => {
    // The stronger promise, and the one that is actually true.
    expect(copy).toMatch(/not even you|nobody sees/i);
  });
});
