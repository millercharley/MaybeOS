import { readFileSync } from 'fs';
import { join } from 'path';
import { readWindows } from '../read-windows';

/**
 * Two numbers should not cost a dozen queries (CMN-25).
 *
 * Charley asked for the unread-count N+1 to be fixed. It was a `count` per
 * channel for posts, another per channel for comments, and another per
 * thread — all in flight at once, from every signed-in page, every sixty
 * seconds. Locally it exhausted the pooler outright.
 */
describe('grouping read cutoffs', () => {
  const t = (iso: string) => new Date(iso);

  it('puts rows that share a cutoff in one window', () => {
    // The ordinary case: a member who has read nothing, so every channel
    // falls back to the day they joined.
    const joined = t('2026-01-01T00:00:00Z');
    const windows = readWindows([
      { id: 'a', after: joined },
      { id: 'b', after: joined },
      { id: 'c', after: joined },
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0].ids.sort()).toEqual(['a', 'b', 'c']);
    expect(windows[0].after).toEqual(joined);
  });

  it('keeps genuinely different cutoffs apart', () => {
    const windows = readWindows([
      { id: 'a', after: t('2026-01-01T00:00:00Z') },
      { id: 'b', after: t('2026-02-01T00:00:00Z') },
      { id: 'c', after: t('2026-01-01T00:00:00Z') },
    ]);

    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.ids.sort())).toEqual([['a', 'c'], ['b']]);
  });

  it('groups by the moment, not by the object', () => {
    // Two equal Dates are different objects. Keying on identity would put
    // every channel in its own window and undo the whole point.
    const windows = readWindows([
      { id: 'a', after: t('2026-01-01T00:00:00Z') },
      { id: 'b', after: t('2026-01-01T00:00:00Z') },
    ]);

    expect(windows).toHaveLength(1);
  });

  it('gives "never read" its own window, counting everything', () => {
    const windows = readWindows([
      { id: 'a', after: null },
      { id: 'b', after: t('2026-01-01T00:00:00Z') },
      { id: 'c', after: null },
    ]);

    const unbounded = windows.find((w) => w.after === null);
    expect(unbounded?.ids.sort()).toEqual(['a', 'c']);
  });

  it('does not confuse the epoch with "never read"', () => {
    // null is keyed as -1 internally. A real date at exactly 0 must not
    // land in the same bucket and silently lose its cutoff.
    const windows = readWindows([
      { id: 'a', after: null },
      { id: 'b', after: new Date(0) },
    ]);

    expect(windows).toHaveLength(2);
    expect(windows.find((w) => w.ids.includes('b'))?.after).toEqual(new Date(0));
  });

  it('orders windows the same way every time', () => {
    // Identical requests should produce identical SQL, or the planner does
    // the work again for each shape.
    const rows = [
      { id: 'a', after: t('2026-03-01T00:00:00Z') },
      { id: 'b', after: t('2026-01-01T00:00:00Z') },
      { id: 'c', after: null },
    ];

    expect(readWindows(rows)).toEqual(readWindows([...rows].reverse()));
  });

  it('loses nobody', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      after: i % 3 === 0 ? null : t(`2026-01-0${(i % 5) + 1}T00:00:00Z`),
    }));

    const seen = readWindows(rows).flatMap((w) => w.ids);
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('answers nothing for nothing', () => {
    expect(readWindows([])).toEqual([]);
  });
});

describe('the badge queries stay collapsed', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
  const commons = read('commons.service.ts');
  const threads = read('threads.service.ts');

  const unreadInCommons = commons.slice(commons.indexOf('private async unreadInCommons'));
  const body = unreadInCommons.slice(0, unreadInCommons.indexOf('\n  }'));

  it('counts the Commons without a query per channel', () => {
    /*
      The regression to guard. `channels.map(...)` around a `count` is the
      shape that was there: cheap per call, and a dozen at once from every
      open tab on a timer.
    */
    expect(body).not.toMatch(/channels\.map\(\s*\(c\)\s*=>\s*this\.prisma/);
    expect(body).toMatch(/readWindows\(/);

    const counts = body.match(/this\.prisma\.\w+\.count\(/g) ?? [];
    expect(counts).toHaveLength(2); // posts, comments — and that is all
  });

  it('counts messages without a query per thread', () => {
    const fn = threads.slice(threads.indexOf('async unreadMessages'));
    const messages = fn.slice(0, fn.indexOf('\n  }'));

    expect(messages).not.toMatch(/seats\.map\(\s*\(seat\)\s*=>\s*this\.prisma/);
    expect(messages).toMatch(/readWindows\(/);
    expect(messages.match(/this\.prisma\.\w+\.count\(/g) ?? []).toHaveLength(1);
  });

  it('still leaves out what the member wrote themselves', () => {
    // Collapsing the clauses must not drop the filters they carried.
    expect(body).toMatch(/authorId: \{ not: userId \}/);
    expect(threads).toMatch(/senderId: \{ not: userId \}/);
  });
});
