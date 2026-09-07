import { PUBLIC_EVENT_SELECT } from '../event-view';

/**
 * What an event published to the open internet may contain (SEC-12).
 *
 * Three unauthenticated routes return events — the public list, the public
 * event page and the JSON feed — and all three used `include`, which returns
 * every column of the event and every column of the room it is in.
 *
 * The room is the serious one. `Room.googleTokens` holds the OAuth tokens for
 * the co-op's connected Google account, and **eight of the nine rooms on
 * production hold one**. Nothing had leaked only because no public event was
 * attached to a room yet; publishing one — the entire point of the feature —
 * would have put a co-op's Google credentials on an endpoint that answers to
 * anybody.
 */
describe('the public shape of an event', () => {
  const room = PUBLIC_EVENT_SELECT.room.select as Record<string, unknown>;

  it('asks the room for its name and nothing else', () => {
    expect(Object.keys(room).sort()).toEqual(['id', 'name']);
  });

  it('never asks the room for the co-op’s Google credentials', () => {
    // Named individually as well as pinned above, because this is the one
    // that mattered and the list is the record of it.
    for (const field of [
      'googleTokens',
      'googleAccountEmail',
      'googleCalendarId',
      'googleCalendarName',
      'googleConnectedAt',
    ]) {
      expect(room).not.toHaveProperty(field);
    }
  });

  it('publishes the venue, which is the point of a public event', () => {
    const location = PUBLIC_EVENT_SELECT.location.select as Record<string, unknown>;
    expect(location).toHaveProperty('address', true);
    expect(location).toHaveProperty('city', true);
  });

  it('does not publish who is hosting', () => {
    // The endpoint already withheld the host's *name* on purpose. It sent the
    // id anyway, which identifies the same member to anyone correlating it.
    expect(PUBLIC_EVENT_SELECT).not.toHaveProperty('host');
    expect(PUBLIC_EVENT_SELECT).not.toHaveProperty('hostId');
  });

  it('does not publish what the host is paid', () => {
    // `hostRevenueShareBps` is the split a co-op agreed with one host for one
    // event. It is between them.
    expect(PUBLIC_EVENT_SELECT).not.toHaveProperty('hostRevenueShareBps');
  });

  it('does not publish the internal ids that join it to other records', () => {
    for (const field of ['bookingId', 'postId', 'parentEventId']) {
      expect(PUBLIC_EVENT_SELECT).not.toHaveProperty(field);
    }
  });

  it('still carries everything a listing renders', () => {
    for (const field of [
      'title',
      'slug',
      'description',
      'startTime',
      'endTime',
      'timezone',
      'imageUrl',
      'priceCents',
      'currency',
      'capacity',
      'tags',
      'visibility',
    ]) {
      expect(PUBLIC_EVENT_SELECT).toHaveProperty(field, true);
    }
  });
});
