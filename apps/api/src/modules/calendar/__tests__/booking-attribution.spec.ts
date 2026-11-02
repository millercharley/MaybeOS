import { titleNameKeys, unambiguousNames } from '../past-host';

/**
 * Whose imported reservation is it (SPC-35)?
 *
 * A member reported that her three bookings for the 5th of December were
 * not in My Bookings. They were in the database, APPROVED, filed under
 * her — four of them, not three — and on the co-op's Google calendar, and
 * she had the confirmation emails. `listUserBookings` filters
 * `isCoopHold: false`, and all four had been flipped to `true`.
 *
 * Two separate faults did it, and both are fixed here.
 *
 * 1. The importer recomputed `isCoopHold` on every pass while only ever
 *    moving `userId` forward. Hers were created correctly on 13 October —
 *    matched by the address on the entry — and a later pass that no longer
 *    resolved that address took them off her without unfiling them. A
 *    booking can therefore stop being yours with nothing in the product
 *    saying so, which is the shape of bug that reads as the member's error.
 *
 * 2. A title was keyed whole, so it matched only an entry called exactly
 *    "Marlo Quint". MaybeItsFate books under a house convention —
 *    "avery lanning · White Elephant · Attic" — and against that the title
 *    named nobody. 203 reservations naming 44 members were co-op holds;
 *    149 of them carry a separator and come back.
 */
describe('titleNameKeys', () => {
  it('keys the whole title, as it always did', () => {
    expect(titleNameKeys('Marlo Quint')).toContain('marlo quint');
  });

  it('also keys the name before a middle dot', () => {
    // The reported shape, exactly as it is stored.
    expect(titleNameKeys('avery lanning · White Elephant · Attic')).toContain(
      'avery lanning',
    );
  });

  it('also keys the name before a bullet', () => {
    expect(titleNameKeys('Avery Lanning • 3rd Floor Attic')).toContain('avery lanning');
  });

  it('normalises the way nameKey does', () => {
    expect(titleNameKeys('  AVERY   LANNING  ·  Attic ')).toContain('avery lanning');
  });

  it('does not split on a hyphen', () => {
    // Plenty of real names contain one, and "Jean-Luc" is not "Jean".
    expect(titleNameKeys('Jean-Luc Picard - Board Room')).not.toContain('jean');
    expect(titleNameKeys('Jean-Luc Picard')).toContain('jean-luc picard');
  });

  it('offers no bare word-prefix to match on', () => {
    /*
      The line this must not cross. A separator is structure the co-op
      wrote; a prefix is a guess, and over-claiming is how one organiser was
      once handed three thousand bookings.
    */
    expect(titleNameKeys('Sarah Jones Memorial Lecture')).toEqual([
      'sarah jones memorial lecture',
    ]);
  });

  it('says nothing for an empty title', () => {
    expect(titleNameKeys('')).toEqual([]);
    expect(titleNameKeys(null)).toEqual([]);
    expect(titleNameKeys(undefined)).toEqual([]);
  });

  it('does not repeat itself when there is no separator', () => {
    expect(titleNameKeys('Avery Lanning')).toEqual(['avery lanning']);
  });

  it('prefers the whole title, so an exact match still wins', () => {
    // A member actually called "A · B" keeps their own entries.
    const keys = titleNameKeys('A · B');
    expect(keys[0]).toBe('a · b');
  });

  it('still refuses a name two members share', () => {
    // The ambiguity rule is upstream of this and must survive it.
    const byName = unambiguousNames([
      { userId: 'u-1', name: 'Avery Lanning' },
      { userId: 'u-2', name: 'avery lanning' },
    ]);
    const hit = titleNameKeys('avery lanning · White Elephant · Attic')
      .map((k) => byName.get(k))
      .find(Boolean);
    expect(hit).toBeUndefined();
  });

  it('finds the member the house convention names', () => {
    const byName = unambiguousNames([
      { userId: 'u-nat', name: 'avery lanning' },
      { userId: 'u-tali', name: 'Sable Reyes' },
    ]);
    const hit = titleNameKeys('avery lanning · White Elephant · Attic')
      .map((k) => byName.get(k))
      .find(Boolean);
    expect(hit).toBe('u-nat');
  });
});

describe('the importer does not take a booking off its owner', () => {
  const SOURCE = require('fs')
    .readFileSync(require('path').join(__dirname, '..', 'calendar-import.service.ts'), 'utf8')
    // Comments blanked, line breaks kept: the file now describes this bug at
    // length and a scan that matched prose would prove nothing.
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

  it('reads the existing attribution before deciding', () => {
    // The shape grew a `source` with SPC-36; what matters is that the pass
    // can see what the row already says before it decides anything.
    for (const field of ['id: true', 'googleEventId: true', 'isCoopHold: true', 'userId: true']) {
      expect(SOURCE).toContain(field);
    }
  });

  it('treats a row already filed under a real member as attributed', () => {
    expect(SOURCE).toMatch(
      /const attributed =\s*\n?\s*existing != null && !existing\.isCoopHold && existing\.userId !== fallback\.userId;/,
    );
  });

  it('keeps an attributed booking out of the co-op holds', () => {
    /*
      SPC-36 put a prior branch in front of this one — a booking MaybeOS
      made is not reconsidered at all. The rule here is the fallback behind
      it and still has to hold: among the reservations the import *may*
      judge, one already attributed to a member is not taken off them.
    */
    expect(SOURCE).toMatch(/attributed \? false : computedCoopHold;/);
  });

  it('still lets a pass with real evidence claim an unattributed one', () => {
    // Promotion must keep working, or the 149 stuck as co-op holds stay
    // stuck.
    expect(SOURCE).toContain('const computedCoopHold =');
    expect(SOURCE).toMatch(/matched === null \|\| \(!named && matched === fallback\.userId\)/);
  });

  it('puts nobody else’s name on a booking that is already somebody’s', () => {
    // `ours ||` joined the front of this with SPC-36; `attributed` still has
    // to be in it, which is what this guards.
    expect(SOURCE).toMatch(/const bookedFor = [^;]*\battributed\b[^;]*\? mine : bookedForPerson;/);
  });

  it('matches a title through the separator-aware keys', () => {
    expect(SOURCE).toContain('titleNameKeys(entry.title)');
    expect(SOURCE).not.toMatch(/nameKey\(entry\.title\)/);
  });

  it('consults the title only when there is no guest line', () => {
    // A guest line is stronger evidence and must still win.
    expect(SOURCE).toMatch(/const byTitle = guest\s*\n?\s*\? null/);
  });
});
