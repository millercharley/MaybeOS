import { channelStream } from '@/lib/channel-stream';
import type { Post, RecentJoins } from '@/lib/api';

/**
 * Where a notice sits in a channel (CMN-11).
 *
 * The bug, in Charley's words and on his screen: a "Someone new is here" card
 * for a member who joined on the 10th of September was sitting above a
 * message from the 18th of August, because the card was pinned to the top of
 * the scroller rather than placed by its own date.
 */
const post = (id: string, createdAt: string) => ({ id, createdAt, body: '' }) as Post;

const joined = (membershipId: string, joinedAt: string, more = 0): RecentJoins => ({
  members: [{ membershipId, userId: `u-${membershipId}`, name: 'Charley Test', headline: null, joinedAt }],
  more,
});

describe('a channel stream', () => {
  it('puts a welcome between the messages it falls between', () => {
    // Exactly the screenshot: 18 Aug message, joined 10 Sep, 12 Sep message.
    const stream = channelStream(
      [post('aug', '2026-08-18T10:00:00Z'), post('sep', '2026-09-12T10:00:00Z')],
      joined('m1', '2026-09-10T10:00:00Z'),
    );

    expect(stream.map((e) => e.key)).toEqual(['post-aug', 'welcome-m1', 'post-sep']);
  });

  it('reads oldest first, so the newest sits nearest the composer', () => {
    const stream = channelStream(
      [post('new', '2026-09-12T10:00:00Z'), post('old', '2026-08-18T10:00:00Z')],
      null,
    );

    expect(stream.map((e) => e.key)).toEqual(['post-old', 'post-new']);
  });

  it('puts a member who joined today at the bottom', () => {
    const stream = channelStream(
      [post('sep', '2026-09-12T10:00:00Z')],
      joined('m1', '2026-09-12T18:00:00Z'),
    );

    expect(stream[stream.length - 1].key).toBe('welcome-m1');
  });

  it('keeps several joins in their own order among the messages', () => {
    const stream = channelStream(
      [post('a', '2026-09-01T00:00:00Z'), post('b', '2026-09-09T00:00:00Z')],
      {
        // Newest first, the way the API returns them.
        members: [
          { membershipId: 'late', userId: 'u1', name: 'Later', headline: null, joinedAt: '2026-09-08T00:00:00Z' },
          { membershipId: 'early', userId: 'u2', name: 'Earlier', headline: null, joinedAt: '2026-09-02T00:00:00Z' },
        ],
        more: 0,
      },
    );

    expect(stream.map((e) => e.key)).toEqual(['post-a', 'welcome-early', 'welcome-late', 'post-b']);
  });

  it('hangs the overflow count on the newest welcome, and only that one', () => {
    const stream = channelStream([], {
      members: [
        { membershipId: 'newest', userId: 'u1', name: 'A', headline: null, joinedAt: '2026-09-10T00:00:00Z' },
        { membershipId: 'older', userId: 'u2', name: 'B', headline: null, joinedAt: '2026-09-08T00:00:00Z' },
      ],
      more: 4,
    });

    const welcomes = stream.filter((e) => e.kind === 'welcome') as Extract<typeof stream[number], { kind: 'welcome' }>[];
    expect(welcomes.map((w) => [w.member.membershipId, w.more])).toEqual([
      ['older', 0],
      ['newest', 4],
    ]);
  });

  it('drops a join with an unreadable date rather than pinning it to the top', () => {
    // NaN sorts unpredictably and `new Date('nonsense').getTime()` is NaN, so
    // the card would land somewhere arbitrary — most often the very top,
    // which is the bug this function exists to fix.
    const stream = channelStream([post('sep', '2026-09-12T10:00:00Z')], joined('bad', 'not a date'));

    expect(stream.map((e) => e.key)).toEqual(['post-sep']);
  });

  it('does not reorder two things that happened in the same second', () => {
    const first = channelStream(
      [post('p', '2026-09-10T10:00:00Z')],
      joined('m1', '2026-09-10T10:00:00Z'),
    ).map((e) => e.key);
    const again = channelStream(
      [post('p', '2026-09-10T10:00:00Z')],
      joined('m1', '2026-09-10T10:00:00Z'),
    ).map((e) => e.key);

    expect(first).toEqual(again);
  });

  it('copes with no notices at all, which is most weeks', () => {
    expect(channelStream([], null)).toEqual([]);
  });
});
