import {
  MAX_CHANNELS,
  MAX_PER_CHANNEL,
  digestFor,
  digestWindow,
  isAway,
  totalPosts,
  wantsDigest,
  wasHere,
  worthSending,
  type DigestPost,
} from '../commons-digest';

/**
 * What a member missed while they were away (CMN-20).
 *
 * The rule is "a weekly digest of things you might have missed **if you
 * didn't log in this week**", and that qualifier is the whole design: a
 * member who reads the Commons must never receive one. Everything here
 * guards the two ways that goes wrong — mailing somebody who was here, and
 * mailing somebody a week of posts they will not read.
 */
const t = (iso: string) => new Date(iso);
const NOW = t('2026-10-19T09:00:00Z');
const { since } = digestWindow(NOW);

function post(over: Partial<DigestPost> = {}): DigestPost {
  return {
    id: 'p1',
    channelId: 'c1',
    channelName: 'Announcements',
    channelEmoji: null,
    authorId: 'someone',
    authorName: 'Someone',
    title: null,
    body: 'Something happened.',
    createdAt: t('2026-10-17T10:00:00Z'),
    commentCount: 0,
    ...over,
  };
}

describe('the window', () => {
  it('looks back a week', () => {
    expect(digestWindow(NOW).since).toEqual(t('2026-10-12T09:00:00Z'));
    expect(digestWindow(NOW).until).toEqual(NOW);
  });
});

describe('whether a member was here', () => {
  it.each([
    ['signed in', { lastLoginAt: t('2026-10-15T09:00:00Z') }],
    ['opened a channel', { lastChannelReadAt: t('2026-10-15T09:00:00Z') }],
    ['opened a conversation', { lastThreadReadAt: t('2026-10-15T09:00:00Z') }],
    ['wrote something', { lastWroteAt: t('2026-10-15T09:00:00Z') }],
  ])('counts somebody who %s', (_why, seen) => {
    expect(wasHere(seen, since)).toBe(true);
  });

  /**
   * The case Charley chose this over `lastLoginAt` for: somebody signed in on
   * their phone who reads the Commons daily and has not typed a password
   * since August. Mailing them a week of posts they have already read is how
   * a digest gets filtered.
   */
  it('counts a reader whose last sign-in was months ago', () => {
    expect(
      wasHere(
        { lastLoginAt: t('2026-08-01T09:00:00Z'), lastChannelReadAt: t('2026-10-18T07:00:00Z') },
        since,
      ),
    ).toBe(true);
  });

  it('does not count somebody whose every trace predates the window', () => {
    expect(
      wasHere(
        {
          lastLoginAt: t('2026-09-01T09:00:00Z'),
          lastChannelReadAt: t('2026-10-01T09:00:00Z'),
          lastThreadReadAt: null,
          lastWroteAt: null,
        },
        since,
      ),
    ).toBe(false);
  });

  it('does not count somebody who has never done anything', () => {
    expect(wasHere({}, since)).toBe(false);
    expect(
      wasHere({ lastLoginAt: null, lastChannelReadAt: null, lastThreadReadAt: null }, since),
    ).toBe(false);
  });

  it('counts activity at the very edge of the window', () => {
    expect(wasHere({ lastLoginAt: since }, since)).toBe(true);
  });
});

describe('deciding who is owed one', () => {
  const away = { userId: 'u1', lastLoginAt: t('2026-08-01T09:00:00Z') };

  it('owes a digest to somebody with no trace in the window', () => {
    expect(isAway(away, new Set(), since)).toBe(true);
  });

  it('owes nothing to somebody the activity sweep found', () => {
    // Read a channel, opened a conversation, posted or commented — the
    // caller folds all four into one set.
    expect(isAway(away, new Set(['u1']), since)).toBe(false);
  });

  it('owes nothing to somebody who signed in during the window', () => {
    expect(
      isAway({ userId: 'u1', lastLoginAt: t('2026-10-18T09:00:00Z') }, new Set(), since),
    ).toBe(false);
  });

  it('owes a digest to somebody who has never signed in at all', () => {
    // 322 of MaybeItsFate's members. They are the whole point of this.
    expect(isAway({ userId: 'u1', lastLoginAt: null }, new Set(), since)).toBe(true);
  });
});

describe('whether they want it', () => {
  it('writes to somebody who has never been asked', () => {
    expect(wantsDigest({ emailOptIn: null, commonsDigestEmails: true })).toBe(true);
  });

  it('respects the co-op-wide opt out', () => {
    expect(wantsDigest({ emailOptIn: false, commonsDigestEmails: true })).toBe(false);
  });

  it('respects this switch on its own', () => {
    expect(wantsDigest({ emailOptIn: true, commonsDigestEmails: false })).toBe(false);
  });
});

describe('what the digest says', () => {
  it('leaves out the member’s own posts', () => {
    // A letter telling somebody what they themselves wrote is the clearest
    // possible signal that nobody reads what MaybeOS sends.
    const channels = digestFor(
      [post({ id: 'mine', authorId: 'me' }), post({ id: 'theirs', authorId: 'you' })],
      'me',
    );

    expect(channels.flatMap((c) => c.posts.map((p) => p.id))).toEqual(['theirs']);
  });

  it('sends nothing when everything in the window was their own', () => {
    const channels = digestFor([post({ authorId: 'me' })], 'me');

    expect(worthSending(channels)).toBe(false);
  });

  it('sends nothing when the week was empty', () => {
    expect(worthSending(digestFor([], 'me'))).toBe(false);
  });

  it('groups by channel, busiest first', () => {
    const channels = digestFor(
      [
        post({ id: 'a', channelId: 'quiet', channelName: 'Quiet' }),
        post({ id: 'b', channelId: 'busy', channelName: 'Busy' }),
        post({ id: 'c', channelId: 'busy', channelName: 'Busy' }),
      ],
      'me',
    );

    expect(channels.map((c) => c.channelName)).toEqual(['Busy', 'Quiet']);
  });

  it('caps the channels it mentions', () => {
    const many = Array.from({ length: MAX_CHANNELS + 3 }, (_, i) =>
      post({ id: `p${i}`, channelId: `c${i}`, channelName: `Channel ${i}` }),
    );

    expect(digestFor(many, 'me')).toHaveLength(MAX_CHANNELS);
  });

  it('caps the posts from each channel, newest first', () => {
    const many = Array.from({ length: MAX_PER_CHANNEL + 4 }, (_, i) =>
      post({ id: `p${i}`, createdAt: t(`2026-10-1${i % 9}T10:00:00Z`) }),
    );
    const [channel] = digestFor(many, 'me');

    expect(channel.posts).toHaveLength(MAX_PER_CHANNEL);
    const times = channel.posts.map((p) => p.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('still counts what it cut, so the digest can say how much it stands for', () => {
    const many = Array.from({ length: 9 }, (_, i) => post({ id: `p${i}` }));
    const channels = digestFor(many, 'me');

    expect(channels[0].posts).toHaveLength(MAX_PER_CHANNEL);
    expect(channels[0].total).toBe(9);
    expect(totalPosts(channels)).toBe(9);
  });
});
