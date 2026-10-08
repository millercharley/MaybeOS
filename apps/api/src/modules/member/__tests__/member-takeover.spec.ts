import {
  blocking,
  movingSummary,
  refusalMessage,
  takeoverRefusal,
  type HuskBlockers,
} from '../member-takeover';

/**
 * Taking an address back from a removed account (MEM-28).
 *
 * Charley, deduplicating the migration: he removed Evan's non-paying duplicate
 * and then could not give the correct address to the paying one — "another
 * member already uses that address". Nobody did. Removing a member deletes the
 * membership and leaves the account, and the husk went on holding the address.
 *
 * The husk is rarely empty. Evan's held three imported room reservations and
 * two share grants worth three hundred shares, which is the whole reason this
 * is a takeover and not a delete.
 */
const NONE: HuskBlockers = {
  threadMessages: 0,
  threadParticipations: 0,
  messageReactions: 0,
  commentReactions: 0,
  attachments: 0,
  coHostings: 0,
};

const husk = { id: 'u-husk', memberships: 0, hasPassword: false, hasSignedIn: false };

describe('whether an address may be taken back', () => {
  it('allows it when the holder is a husk from a removal', () => {
    // No memberships anywhere, no password, never signed in.
    expect(takeoverRefusal(husk, 'u-keep', NONE)).toBeNull();
  });

  it('refuses an account that is still a member somewhere', () => {
    /*
      The case the original message assumed, and the only one it was right
      about. A live account's address is not an admin's to reassign — least of
      all from another co-op.
    */
    expect(takeoverRefusal({ ...husk, memberships: 1 }, 'u-keep', NONE)).toBe('still-a-member');
  });

  it('refuses an account somebody signs in with', () => {
    // A password or a sign-in is somebody's way in, whatever co-op they have
    // since left. No roster tidy-up is worth taking that.
    expect(takeoverRefusal({ ...husk, hasPassword: true }, 'u-keep', NONE)).toBe('in-use');
    expect(takeoverRefusal({ ...husk, hasSignedIn: true }, 'u-keep', NONE)).toBe('in-use');
  });

  it('puts being a member ahead of being signed into', () => {
    // An admin whose colleague simply has this address needs to hear that, not
    // a sentence about passwords.
    expect(
      takeoverRefusal({ ...husk, memberships: 1, hasPassword: true }, 'u-keep', NONE),
    ).toBe('still-a-member');
  });

  it('refuses when the husk carries something a takeover cannot move', () => {
    /*
      These are the relations that *cascade* from a user, so the delete would
      destroy them rather than preserve them. Everything else either survives
      unlinked or refuses the delete outright, and neither loses anything.
    */
    expect(takeoverRefusal(husk, 'u-keep', { ...NONE, threadMessages: 4 })).toBe('carries-things');
    expect(takeoverRefusal(husk, 'u-keep', { ...NONE, attachments: 1 })).toBe('carries-things');
    expect(takeoverRefusal(husk, 'u-keep', { ...NONE, coHostings: 2 })).toBe('carries-things');
  });

  it('says so when nothing holds the address at all', () => {
    expect(takeoverRefusal(null, 'u-keep', NONE)).toBe('nothing-to-take');
  });

  it('says so when the member already has it', () => {
    expect(takeoverRefusal({ ...husk, id: 'u-keep' }, 'u-keep', NONE)).toBe('already-theirs');
  });
});

describe('what the admin is told', () => {
  it('names what is in the way, with numbers', () => {
    const message = refusalMessage('carries-things', { ...NONE, threadMessages: 1, attachments: 3 });

    expect(message).toContain('1 message');
    expect(message).toContain('3 uploaded files');
    expect(message).toContain('Nothing has been changed');
  });

  it('counts one of something in the singular', () => {
    expect(blocking({ ...NONE, coHostings: 1 })).toEqual(['1 event it co-hosts']);
    expect(blocking({ ...NONE, coHostings: 2 })).toEqual(['2 events it co-hosts']);
  });

  it('no longer sends them looking for a second account that is gone', () => {
    // "Check whether they have two accounts here" is advice that cannot be
    // followed when one of them is the account they removed five minutes ago.
    expect(refusalMessage('still-a-member', NONE)).not.toMatch(/two accounts/);
  });
});

describe('what is about to move', () => {
  it('leads with the shares, because that is the part worth stopping over', () => {
    const summary = movingSummary({ bookings: 3, shareGrants: 2, shares: 300 });

    expect(summary).toContain('300 shares across 2 grants');
    expect(summary).toContain('3 room reservations');
  });

  it('counts a single share and a single reservation properly', () => {
    expect(movingSummary({ bookings: 1, shareGrants: 1, shares: 1 })).toContain(
      '1 share across 1 grant',
    );
    expect(movingSummary({ bookings: 1, shareGrants: 0, shares: 0 })).toContain(
      '1 room reservation',
    );
  });

  it('says plainly when there is nothing but the address', () => {
    expect(movingSummary({ bookings: 0, shareGrants: 0, shares: 0 })).toMatch(/only the address/);
  });

  it('still mentions grants that are worth no shares', () => {
    expect(movingSummary({ bookings: 0, shareGrants: 2, shares: 0 })).toContain('2 share grants');
  });
});
