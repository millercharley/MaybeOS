import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * A method handed a transaction must use it (OPS-24, and again on 2026-08-20).
 *
 * `connection_limit=1`. An interactive transaction holds the only connection
 * there is, so a query issued through the *ambient* client inside one waits
 * for a connection that cannot arrive — until the transaction times out and
 * the webhook answers 500. Stripe then retries, and the retry does the same.
 *
 * This is not a hypothetical. It timed out every ticket webhook until
 * 2026-08-18, was fixed, was documented in a comment directly above the
 * dispatch, **and was reintroduced two days later** by a method that took a
 * `PrismaTx` and then counted members through `this.prisma`. It surfaced only
 * because Charley resent a live Stripe event and saw a 500.
 *
 * A comment did not hold the line. This does: if a method's signature accepts
 * a transaction, its body may not touch the ambient client.
 */
describe('methods that take a PrismaTx use it', () => {
  const dir = join(__dirname, '..', '..');

  const sources: Array<{ file: string; text: string }> = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) sources.push({ file: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);

  /** Method bodies whose parameter list mentions `PrismaTx`. */
  const transactionalMethods = sources.flatMap(({ file, text }) => {
    const found: Array<{ file: string; name: string; body: string }> = [];
    const signature = /(?:private |public |protected )?async (\w+)\(([^)]*)\)\s*:\s*Promise<[^>]*>\s*\{/g;

    for (const match of text.matchAll(signature)) {
      if (!/PrismaTx/.test(match[2])) continue;

      // Walk braces from the opening one to find the method's own body.
      let depth = 0;
      let i = match.index! + match[0].length - 1;
      const start = i;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      found.push({ file, name: match[1], body: text.slice(start, i) });
    }
    return found;
  });

  it('finds the transactional methods to check', () => {
    // If this drops to zero the regex has rotted and the suite is asserting
    // nothing, which is worse than failing.
    expect(transactionalMethods.length).toBeGreaterThan(2);
  });

  it.each(['syncPlanQuantity', 'handleUpcomingInvoice', 'applyPlanFromCheckout'])(
    '%s is one of them',
    (name) => {
      expect(transactionalMethods.map((m) => m.name)).toContain(name);
    },
  );

  it('none of them queries through the ambient client', () => {
    const offenders = transactionalMethods
      .filter((m) => /this\.prisma\.\w+\.\w/.test(m.body))
      .map((m) => `${m.name} (${m.file.split('/src/')[1]})`);

    if (offenders.length > 0) {
      throw new Error(
        `These take a transaction and then query around it:\n  ${offenders.join('\n  ')}\n\n` +
          `connection_limit=1 — the transaction holds the only connection, so this waits ` +
          `for one that cannot arrive and the webhook answers 500 (OPS-24). Use the tx.`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
