import {
  THREAD_CHANNELS,
  shouldAnnounce,
  threadOwnerId,
  whyNotAnnounced,
  type Announceable,
} from '../thread-policy';

const subject = (over: Partial<Announceable> = {}): Announceable => ({
  isPublished: true,
  visibility: 'MEMBERS_ONLY',
  alreadyThreaded: false,
  ...over,
});

/**
 * Whether something gets a thread in the Commons (CMN-22).
 *
 * Every "no" here is a leak or a pile of noise that was prevented, which is
 * why they are separate tests rather than one table.
 */
describe('whether it gets a thread', () => {
  it('announces something published to the co-op', () => {
    expect(shouldAnnounce(subject())).toBe(true);
  });

  it('announces something published to anyone', () => {
    expect(shouldAnnounce(subject({ visibility: 'PUBLIC' }))).toBe(true);
  });

  /** The draft rule TCH-02 leans on: nothing leaves a draft. */
  it('never announces a draft', () => {
    expect(shouldAnnounce(subject({ isPublished: false }))).toBe(false);
    expect(whyNotAnnounced(subject({ isPublished: false }))).toBe('still a draft');
  });

  /**
   * The leak EVT-42 named: #Events is read by every member, and posting a
   * private thing there overrides the answer its owner gave about who sees
   * it.
   */
  it('never announces something kept off the lists', () => {
    expect(shouldAnnounce(subject({ visibility: 'PRIVATE' }))).toBe(false);
    expect(whyNotAnnounced(subject({ visibility: 'PRIVATE' }))).toBe('kept off the lists');
  });

  /** Published, unpublished, published again is one announcement. */
  it('announces once and not again', () => {
    expect(shouldAnnounce(subject({ alreadyThreaded: true }))).toBe(false);
  });

  /**
   * A workshop's six evenings would otherwise put one post in #Teaching and
   * six in #Events, splitting the questions across seven threads.
   */
  it('does not announce a date that belongs to an offering', () => {
    expect(shouldAnnounce(subject({ belongsToOffering: true }))).toBe(false);
    expect(whyNotAnnounced(subject({ belongsToOffering: true }))).toMatch(/own thread/);
  });

  it('has nothing to explain when it does announce', () => {
    expect(whyNotAnnounced(subject())).toBeNull();
  });
});

/**
 * One thread for a repeating series (Charley, 2026-11-17), which the data
 * model already half-decided: `Event.postId` is unique, so twelve rows could
 * not share one post even if we wanted them to.
 */
describe('which event owns the thread', () => {
  it('is the event itself when it stands alone', () => {
    expect(threadOwnerId({ id: 'e1', parentEventId: null })).toBe('e1');
    expect(threadOwnerId({ id: 'e1' })).toBe('e1');
  });

  it('is the series root for every date in a series', () => {
    expect(threadOwnerId({ id: 'e7', parentEventId: 'root' })).toBe('root');
    expect(threadOwnerId({ id: 'e8', parentEventId: 'root' })).toBe('root');
  });
});

describe('the two standard channels', () => {
  it('knows both, by the slug the unique index uses', () => {
    expect(THREAD_CHANNELS.events.slug).toBe('events');
    expect(THREAD_CHANNELS.teaching.slug).toBe('teaching');
  });

  /**
   * The slug is what decides whether a co-op already has one. A co-op that
   * renamed Events to "What's On" must keep its name, so the upsert matches
   * on slug and updates nothing — and `events` is the slug EVT-42 already
   * created channels under, so this inherits them rather than making a
   * second one.
   */
  it('uses the slug EVT-42 already created', () => {
    expect(THREAD_CHANNELS.events.slug).toBe('events');
  });

  it('gives each one words a member would recognise', () => {
    for (const channel of Object.values(THREAD_CHANNELS)) {
      expect(channel.name).toMatch(/^[A-Z]/);
      expect(channel.description.length).toBeGreaterThan(10);
      expect(channel.emoji).toBeTruthy();
    }
  });
});
