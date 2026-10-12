import { nameKey, unambiguousNames } from '../past-host';

/**
 * Whose reservation a hand-typed calendar entry is (SPC-34).
 *
 * Charley: "See why the migration of the calendars did not connect this
 * member to her events."
 *
 * Brooke Sullivan Brown held the Attic and the Library on 24 October. Both
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
    expect(nameKey('  Brooke   Sullivan Brown ')).toBe('brooke sullivan brown');
    expect(nameKey('BROOKE SULLIVAN BROWN')).toBe('brooke sullivan brown');
  });

  it('is nothing for a title that is not there', () => {
    expect(nameKey('')).toBeNull();
    expect(nameKey('   ')).toBeNull();
    expect(nameKey(null)).toBeNull();
  });
});

describe('which names identify somebody', () => {
  const members = [
    { userId: 'u-brooke', name: 'Brooke Sullivan Brown' },
    { userId: 'u-mel', name: 'Melanie Love' },
  ];

  it('maps a member to their name', () => {
    const by = unambiguousNames(members);

    expect(by.get('brooke sullivan brown')).toBe('u-brooke');
    expect(by.get('melanie love')).toBe('u-mel');
  });

  it('refuses a name two members share', () => {
    /*
      A reservation handed to the wrong one of two people with the same name
      is worse than one handed to nobody — the room looks held by somebody
      who did not hold it, and the person who did still cannot publish.
    */
    const by = unambiguousNames([...members, { userId: 'u-other', name: 'Melanie Love' }]);

    expect(by.has('melanie love')).toBe(false);
    expect(by.get('brooke sullivan brown')).toBe('u-brooke');
  });

  it('is not confused by the same member appearing twice', () => {
    const by = unambiguousNames([members[0], { ...members[0] }]);
    expect(by.get('brooke sullivan brown')).toBe('u-brooke');
  });

  it('ignores members with no name', () => {
    const by = unambiguousNames([{ userId: 'u-x', name: null }, { userId: 'u-y', name: '  ' }]);
    expect(by.size).toBe(0);
  });
});

describe('what the importer does with it', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'calendar-import.service.ts'),
    'utf8',
  );
  const writeBookings = src.slice(src.indexOf('private async writeBookings'));

  it('prefers the guest line, which is the stronger signal', () => {
    // The automation writes "Guest • Abby Ferree (…)" and that names the
    // person outright. A title is a guess by comparison.
    expect(writeBookings).toMatch(/const titleKey = guest \? null : nameKey\(entry\.title\)/);
    expect(writeBookings).toMatch(/const matched = byTitle \?\? byEmail/);
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
    expect(writeBookings).toMatch(
      /\.\.\.\(byTitle && byTitle !== fallback\.userId \? \{ userId: byTitle \} : \{\}\)/,
    );
  });

  it('will not hand a reservation to the fallback organiser by title', () => {
    // That is the state being corrected; re-applying it would be a no-op at
    // best and would undo a real correction at worst.
    expect(writeBookings).toMatch(/byTitle !== fallback\.userId/);
  });
});
