import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameKey, titleNameKeys, unambiguousNames } from '../past-host';

/**
 * Whose reservation a hand-typed calendar entry is (SPC-34).
 *
 * Charley: "See why the migration of the calendars did not connect this
 * member to her events."
 *
 * Marlo Quint held the Attic and the Library on 24 October. Both
 * entries were typed onto the shared room calendars by hand, with her name
 * as the title and nothing else to go on — no guest line, and a creator who
 * was whoever was at the keyboard.
 *
 * So the importer filed them under him, and then marked them the co-op's
 * precisely *because* it had fallen back to him. 47 reservations arrived
 * that way, 26 of them still to come, and their owners were told they had no
 * bookings and should go and book the rooms they already held.
 */
describe('reading a name out of a title', () => {
  it('matches however it was typed', () => {
    expect(nameKey('  Marlo   Quint ')).toBe('marlo quint');
    expect(nameKey('MARLO QUINT')).toBe('marlo quint');
  });

  it('is nothing for a title that is not there', () => {
    expect(nameKey('')).toBeNull();
    expect(nameKey('   ')).toBeNull();
    expect(nameKey(null)).toBeNull();
  });
});

describe('which names identify somebody', () => {
  const members = [
    { userId: 'u-marlo', name: 'Marlo Quint' },
    { userId: 'u-mel', name: 'Noor Haddad' },
  ];

  it('maps a member to their name', () => {
    const by = unambiguousNames(members);

    expect(by.get('marlo quint')).toBe('u-marlo');
    expect(by.get('noor haddad')).toBe('u-mel');
  });

  it('refuses a name two members share', () => {
    /*
      A reservation handed to the wrong one of two people with the same name
      is worse than one handed to nobody — the room looks held by somebody
      who did not hold it, and the person who did still cannot publish.
    */
    const by = unambiguousNames([...members, { userId: 'u-other', name: 'Noor Haddad' }]);

    expect(by.has('noor haddad')).toBe(false);
    expect(by.get('marlo quint')).toBe('u-marlo');
  });

  it('is not confused by the same member appearing twice', () => {
    const by = unambiguousNames([members[0], { ...members[0] }]);
    expect(by.get('marlo quint')).toBe('u-marlo');
  });

  it('ignores members with no name', () => {
    const by = unambiguousNames([{ userId: 'u-x', name: null }, { userId: 'u-y', name: '  ' }]);
    expect(by.size).toBe(0);
  });
});

describe('what the importer does with it', () => {
  const src = readFileSync(join(__dirname, '..', 'calendar-import.service.ts'), 'utf8');
  const writeBookings = src.slice(src.indexOf('private async writeBookings'));

  it('reads the title whether or not there is a guest line (SPC-38)', () => {
    /*
      This used to pin `const byTitle = guest ? null : nameKey(entry.title)`,
      and then the keyed version of the same expression. The reasoning was
      that a guest line names the person outright and a title is a guess by
      comparison.

      True of a guest line whose address resolves. 211 of MaybeItsFate's
      reservations carry one naming a current member under an address MaybeOS
      has never seen — a personal account given to the booking tool instead
      of the one they joined with — so the address resolved to nobody, and
      because the line existed the title naming the very same person was
      never read. One member's standing Salon booking runs to 2028 that way.

      The precedence is what carries the old rule now: a guest *address* that
      resolves still beats everything.
    */
    expect(writeBookings).toMatch(/titleNameKeys\(entry\.title\)/);
    expect(writeBookings).not.toMatch(/const byTitle = guest\s*\n?\s*\? null/);
    expect(writeBookings).toMatch(/const matched = guest \? \(byEmail \?\? byPerson\) : \(byPerson \?\? byEmail\);/);
  });

  it('matches the name on the guest line the same way a title’s is', () => {
    // Against members whose name belongs to exactly one of them — never a
    // bare address, which is what `byEmail` already is.
    expect(writeBookings).toMatch(/const byGuestName = guest \? \(byName\.get\(nameKey\(guest\.name\) \?\? ''\)/);
  });

  it('counts a matched title as naming somebody', () => {
    /*
      The half that matters. Without it these stay co-op holds, which the
      room picker filters out — so correcting only who they belong to would
      have left them exactly as invisible as before.
    */
    expect(writeBookings).toMatch(/const named = Boolean\(guest\) \|\| byTitle !== null/);
  });

  it('corrects a row it got wrong before it could read titles', () => {
    // The update path leaves `userId` alone on purpose, so a reservation
    // somebody has been handed stays theirs. A title now naming a member is
    // the one thing that moves it.
    //
    // SPC-36 added `!ours &&` in front: a booking MaybeOS made is never
    // moved by the import, however the calendar entry is titled. The
    // correction this guards is for imported rows, which is all it ever
    // meant.
    //
    // `byPerson` since SPC-38 — `byGuestName ?? byTitle`, a name from either
    // place. Deliberately not an address: one that resolves on one pass and
    // not the next is how SPC-35 took four reservations off the member who
    // made them.
    expect(writeBookings).toMatch(
      /\.\.\.\(!ours && byPerson && byPerson !== fallback\.userId \? \{ userId: byPerson \} : \{\}\)/,
    );
  });

  it('will not hand a reservation to the fallback organiser by name', () => {
    // That is the state being corrected; re-applying it would be a no-op at
    // best and would undo a real correction at worst.
    expect(writeBookings).toMatch(/byPerson !== fallback\.userId/);
  });
});

/**
 * The shapes MaybeItsFate's rooms were actually booked under (SPC-38).
 *
 * Every title below is the shape of a real reservation, counted against
 * production on 18 November; the names are stand-ins, as everywhere else in
 * this file. The point of keeping them is that each one was a co-op hold
 * nobody could see, and each failed for a different reason.
 */
describe('reading a name out of the shapes a co-op actually types', () => {
  const key = 'avery lanning';

  it('takes the name wherever the separators put it', () => {
    // "Art Improv • Carolyn Dube • Attic" — what it is first, who booked it
    // second. Keying the lead segment alone matched nobody here.
    expect(titleNameKeys('Art Improv • Avery Lanning • Attic')).toContain(key);
    expect(titleNameKeys('Avery Lanning • 3rd Floor Attic')).toContain(key);
    expect(titleNameKeys('avery lanning · White Elephant · Attic')).toContain(key);
  });

  it('treats a spaced dash as a separator', () => {
    expect(titleNameKeys('Avery Lanning - Meaningful Conversation')).toContain(key);
    expect(titleNameKeys('Avery Lanning – Dog Sees God')).toContain(key);
  });

  it('does not split a hyphenated surname', () => {
    /*
      The reason the original refused hyphens outright, and a real member:
      "Abbi Heimach-Snipes". A hyphen inside a name has no spaces around it,
      which is the whole distinction " - " rests on — so the name survives
      whole and the halves are never offered as keys.
    */
    expect(titleNameKeys('Abbi Heimach-Snipes')).toEqual(['abbi heimach-snipes']);
    expect(titleNameKeys('Abbi Heimach-Snipes • Attic')).toContain('abbi heimach-snipes');
    expect(titleNameKeys('Abbi Heimach-Snipes')).not.toContain('abbi heimach');
  });

  it('reads the label a hold is written under, all four ways', () => {
    // The co-op writes it with a preposition, with a colon, with neither,
    // and after the name.
    expect(titleNameKeys('HOLD for Avery Lanning')).toContain(key);
    expect(titleNameKeys('Hold: Avery Lanning')).toContain(key);
    expect(titleNameKeys('HOLD Avery Lanning • Zen Room')).toContain(key);
    expect(titleNameKeys('Avery Lanning Hold')).toContain(key);
  });

  it('does not take “hold” out of a name that begins with it', () => {
    // `\bhold\b`, so Holden keeps his.
    expect(titleNameKeys('Holden Reese')).toEqual(['holden reese']);
  });

  it('still refuses a bare prefix', () => {
    /*
      The caution this file was built on, and it is still right: 73 of
      MaybeItsFate's reservations name a member this way and stay the
      co-op's. "Sarah Jones Memorial Lecture" is not Sarah Jones's booking,
      and a programme series names its performer, not whoever booked the
      room. None of the 73 is in the future, so nobody is shut out of a room
      by leaving them alone.
    */
    expect(titleNameKeys('Avery Lanning Workshop')).not.toContain(key);
    expect(titleNameKeys('Avery Lanning Yoga')).not.toContain(key);
    // Two people named and no way to tell whose it is.
    expect(titleNameKeys('HOLD for Avery Lanning and Rosalind Pike')).not.toContain(key);
    expect(titleNameKeys('Music in the Attic: Avery Lanning')).not.toContain(key);
  });

  it('offers no key twice, and none for nothing', () => {
    // The caller maps every key against a member lookup, so a duplicate is
    // only waste — but a title that is one segment produced it every time.
    expect(titleNameKeys('Avery Lanning')).toEqual([key]);
    expect(titleNameKeys('  •  ')).toEqual([]);
    expect(titleNameKeys(null)).toEqual([]);
  });
});
