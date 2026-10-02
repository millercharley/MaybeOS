import { slugBase, slugCandidates } from '../event-slug';

/**
 * A unique address for an imported event (CAL-04).
 *
 * MaybeItsFate's first real calendar import died here, on 2026-10-02:
 *
 *   Invalid `prisma.event.upsert()` invocation:
 *   Unique constraint failed on the fields: (`orgId`,`slug`)
 *
 * The old rule was "the title, and if that is taken, the title with the
 * date", and the second was used whether or not it was free. A co-op with
 * two things of the same name on the same day — a class at 10 and at 2 — hit
 * the constraint, and because one row threw, the whole import stopped. The
 * organiser saw "request failed".
 */

describe('turning a title into an address', () => {
  it('reads as the title', () => {
    expect(slugBase('Open Studio Night')).toBe('open-studio-night');
  });

  it('keeps punctuation and accents out of a URL', () => {
    expect(slugBase('Clay & Coffee — 6pm!')).toBe('clay-coffee-6pm');
  });

  it('never ends in a dash, even when the cut lands on one', () => {
    // `.slice(0, 60)` can land mid-separator, and a trailing dash in an
    // address looks like a mistake because it is one.
    const long = `${'a'.repeat(59)} and then some more words`;

    expect(slugBase(long)).not.toMatch(/-$/);
    expect(slugBase(long).length).toBeLessThanOrEqual(60);
  });

  it('has something to say about an untitled event', () => {
    expect(slugBase('')).toBe('event');
    expect(slugBase('!!!')).toBe('event');
  });
});

describe('the candidates an import tries', () => {
  const start = new Date('2026-03-14T18:00:00Z');

  it('offers the plain title first', () => {
    expect(slugCandidates('Open Studio', start, 'g-1')[0]).toBe('open-studio');
  });

  it('then the date, for a weekly thing with one name', () => {
    expect(slugCandidates('Open Studio', start, 'g-1')[1]).toBe('open-studio-2026-03-14');
  });

  it('then numbers them, for two of the same on one day', () => {
    // The case that broke the import: a class at 10am and the same class at
    // 2pm share a title *and* a date.
    const candidates = slugCandidates('Open Studio', start, 'g-1');

    expect(candidates[2]).toBe('open-studio-2026-03-14-2');
    expect(candidates[3]).toBe('open-studio-2026-03-14-3');
  });

  it('ends with one that cannot collide', () => {
    // `googleEventId` is unique within a co-op, so a slug built from it is
    // too. Ugly, and only reached by an event that already shares a title and
    // a day with eleven others — an ugly address beats a failed import.
    const [last] = slugCandidates('Open Studio', start, 'google-abc-123').slice(-1);

    expect(last).toMatch(/^open-studio-[a-z0-9]+$/);
    expect(last).not.toBe('open-studio-2026-03-14');
  });

  it('gives two different events two different last resorts', () => {
    const a = slugCandidates('Open Studio', start, 'google-abc-123').slice(-1)[0];
    const b = slugCandidates('Open Studio', start, 'google-def-456').slice(-1)[0];

    expect(a).not.toBe(b);
  });

  it('gives the same event the same one twice, so a re-run is stable', () => {
    expect(slugCandidates('Open Studio', start, 'g-1').slice(-1)[0]).toBe(
      slugCandidates('Open Studio', start, 'g-1').slice(-1)[0],
    );
  });

  it('is finite', () => {
    // An import that asked for candidates forever would hang the Lambda
    // rather than fail it, which is harder to notice and worse to debug.
    expect(slugCandidates('Open Studio', start, 'g-1').length).toBeLessThan(20);
  });

  it('never offers the same address twice', () => {
    const candidates = slugCandidates('Open Studio', start, 'g-1');

    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
