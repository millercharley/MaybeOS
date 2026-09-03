import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The global rate limits have to be above what a page load costs (OPS-34).
 *
 * They were 3 per second. The member profile page fans out six requests at
 * once, so it 429'd on every load — in production as much as in dev — and the
 * page never rendered. A limit set below the product's own floor is not
 * protection, it is an outage with a status code.
 *
 * This is a guard against tightening them back without noticing what breaks:
 * the numbers are readable, so state what they have to clear.
 */
const source = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf8');

function limitFor(name: string): { ttl: number; limit: number } {
  const block = new RegExp(
    `name: '${name}',\\s*ttl: (\\d+),\\s*limit: (\\d+)`,
  ).exec(source);
  if (!block) throw new Error(`No '${name}' throttle found in app.module.ts`);
  return { ttl: Number(block[1]), limit: Number(block[2]) };
}

/** The widest fan-out a single page currently performs, plus headroom. */
const REQUESTS_PER_PAGE_LOAD = 12;

describe('global rate limits', () => {
  it('let a single page load finish', () => {
    const short = limitFor('short');
    expect(short.ttl).toBe(1000);
    expect(short.limit).toBeGreaterThanOrEqual(REQUESTS_PER_PAGE_LOAD * 2);
  });

  it('let somebody click through several screens without being cut off', () => {
    // Four pages in ten seconds is reading the product, not attacking it.
    const medium = limitFor('medium');
    expect(medium.ttl).toBe(10000);
    expect(medium.limit).toBeGreaterThanOrEqual(REQUESTS_PER_PAGE_LOAD * 4);
  });

  it('still bound sustained traffic', () => {
    // Generous is not absent: a client hammering the API is still stopped.
    const long = limitFor('long');
    expect(long.ttl).toBe(60000);
    expect(long.limit).toBeLessThanOrEqual(5000);
  });

  it('leaves the credential endpoints on their own strict limits', () => {
    // This is where brute force is actually stopped, and raising the global
    // limits must never be read as having relaxed it.
    const auth = readFileSync(
      join(__dirname, '..', 'modules', 'auth', 'auth.controller.ts'),
      'utf8',
    );
    const perMinute = [...auth.matchAll(/@Throttle\(\{ short: \{ limit: (\d+), ttl: (\d+) \} \}\)/g)];

    expect(perMinute.length).toBeGreaterThanOrEqual(4);
    for (const m of perMinute) {
      expect(Number(m[1])).toBeLessThanOrEqual(5);
      expect(Number(m[2])).toBeGreaterThanOrEqual(60000);
    }
  });
});
