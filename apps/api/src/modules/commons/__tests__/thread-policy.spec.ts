import {
  THREAD_CHANNELS,
  excerptOf,
  hasStakeInThread,
  shouldAnnounce,
  threadOwnerId,
  whoHearsAboutReply,
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

/**
 * Who hears that somebody replied (CMN-22).
 */
describe('who hears about a reply', () => {
  it('tells the host', () => {
    expect(whoHearsAboutReply({ ownerId: 'maya', replierId: 'alex' })).toBe('maya');
  });

  /**
   * The failure that is invisible in testing, because the developer is always
   * the host, and obvious to everybody else the day it ships.
   */
  it('never emails somebody about their own reply', () => {
    expect(whoHearsAboutReply({ ownerId: 'maya', replierId: 'maya' })).toBeNull();
  });

  it('has nobody to tell when nobody is running it', () => {
    expect(whoHearsAboutReply({ ownerId: null, replierId: 'alex' })).toBeNull();
    expect(whoHearsAboutReply({ ownerId: undefined, replierId: 'alex' })).toBeNull();
  });
});

/**
 * Whether a member's badge lights up for one of these threads (CMN-22).
 *
 * Charley: "For a non-host of an event or teaching session: only events that
 * you RSVP'd and/or your messages that get replies should signal a new
 * message alert."
 */
describe('whether a member has a stake', () => {
  it('has none by default, which is the point', () => {
    expect(hasStakeInThread({})).toBe(false);
  });

  it.each([
    ['running it', { isOwner: true }],
    ['going to it', { hasRsvp: true }],
    ['asked about it', { registeredInterest: true }],
    ['said something in it', { hasWritten: true }],
  ])('has one for %s', (_why, stake) => {
    expect(hasStakeInThread(stake)).toBe(true);
  });

  /**
   * The whole reason this exists: every published event lands in #Events, so
   * counting it like an ordinary channel gives every member a badge that
   * never clears and none of them asked for.
   */
  it('gives a bystander nothing to clear', () => {
    expect(
      hasStakeInThread({
        isOwner: false,
        hasRsvp: false,
        registeredInterest: false,
        hasWritten: false,
      }),
    ).toBe(false);
  });
});

/**
 * A reply, shortened for an email (CMN-22). Comment bodies are HTML, and the
 * email template escapes what it is handed.
 */
describe('the excerpt that goes in the email', () => {
  it('takes the words out of the markup', () => {
    expect(excerptOf('<p>Is there <strong>parking</strong>?</p>')).toBe('Is there parking?');
  });

  /** Two paragraphs must not run together into one word. */
  it('keeps a gap where a block ended', () => {
    expect(excerptOf('<p>First.</p><p>Second.</p>')).toBe('First. Second.');
    expect(excerptOf('<p>Line one<br>Line two</p>')).toBe('Line one Line two');
  });

  it('turns entities back into characters', () => {
    expect(excerptOf('<p>Tea &amp; cake &lt;3</p>')).toBe('Tea & cake <3');
    expect(excerptOf('<p>Space&nbsp;here</p>')).toBe('Space here');
  });

  /**
   * Left as HTML it would arrive as visible angle brackets; unescaped it
   * would put a member's markup inside ours.
   */
  it('leaves no tags behind for the template to escape', () => {
    expect(excerptOf('<p>a<script>alert(1)</script>b</p>')).not.toMatch(/[<>]/);
  });

  it('shortens a long one and says it did', () => {
    const long = `<p>${'word '.repeat(200)}</p>`;
    const out = excerptOf(long);

    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves a short one exactly as it reads', () => {
    expect(excerptOf('<p>Can I bring my kid?</p>')).toBe('Can I bring my kid?');
  });

  /** One enormous word is better cut bluntly than shown as nothing. */
  it('cuts a single huge word rather than returning an ellipsis', () => {
    const out = excerptOf(`<p>${'x'.repeat(400)}</p>`);

    expect(out.length).toBeGreaterThan(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is unbothered by an empty body', () => {
    expect(excerptOf('<p></p>')).toBe('');
  });
});
