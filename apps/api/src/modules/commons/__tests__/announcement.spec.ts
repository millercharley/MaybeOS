import {
  announcementSubject,
  finished,
  stillOwed,
  wantsAnnouncements,
  type Recipient,
} from '../announcement';

/**
 * Emailing a Commons post to the whole roster (CMN-21).
 *
 * The expensive mistakes here are all in front of four hundred people:
 * writing to somebody who asked you not to, and writing to somebody twice
 * because the send had to be done in passes.
 */
function member(over: Partial<Recipient> = {}): Recipient {
  return {
    id: 'm1',
    userId: 'u1',
    email: 'ruth@outlook.com',
    altEmail: null,
    emailOptIn: null,
    announcementEmails: true,
    ...over,
  };
}

describe('whether a member wants announcements', () => {
  it('writes to somebody who has never been asked', () => {
    expect(wantsAnnouncements({ emailOptIn: null, announcementEmails: true })).toBe(true);
  });

  /**
   * An organiser with something urgent will argue this one is different. It
   * is not: a member who switched a co-op's email off and got one anyway has
   * learned the switch is decorative.
   */
  it('respects the co-op-wide opt out even for an announcement', () => {
    expect(wantsAnnouncements({ emailOptIn: false, announcementEmails: true })).toBe(false);
  });

  it('respects the announcement switch on its own', () => {
    expect(wantsAnnouncements({ emailOptIn: true, announcementEmails: false })).toBe(false);
  });
});

describe('who is still owed a copy', () => {
  it('owes everybody on the first pass', () => {
    const out = stillOwed([member({ id: 'a' }), member({ id: 'b' })], new Set());
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });

  /** The retry is the normal case here, not the exception. */
  it('never hands back somebody who already has one', () => {
    const out = stillOwed([member({ id: 'a' }), member({ id: 'b' })], new Set(['a']));
    expect(out.map((m) => m.id)).toEqual(['b']);
  });

  it('skips a member with no address', () => {
    expect(stillOwed([member({ email: null })], new Set())).toEqual([]);
  });

  it('skips a member who opted out', () => {
    expect(stillOwed([member({ announcementEmails: false })], new Set())).toEqual([]);
  });

  it('owes nothing once everybody has been written to', () => {
    expect(stillOwed([member({ id: 'a' })], new Set(['a']))).toEqual([]);
  });
});

describe('knowing when to stop', () => {
  it('is finished only when nothing is left', () => {
    expect(finished({ sent: 150, total: 394, remaining: 0 })).toBe(true);
    expect(finished({ sent: 150, total: 150, remaining: 244 })).toBe(false);
  });
});

describe('the subject line', () => {
  it('uses the post’s title when it has one', () => {
    expect(announcementSubject('MaybeItsFate', 'Potluck is tomorrow')).toBe('Potluck is tomorrow');
  });

  it.each([
    ['no title', null],
    ['an empty title', ''],
    ['a whitespace title', '   '],
  ])('says who it is from when there is %s', (_why, title) => {
    // The Commons composer does not ask for a title, so this is the common
    // case rather than the exception.
    expect(announcementSubject('MaybeItsFate', title)).toBe('A message from MaybeItsFate');
  });
});
