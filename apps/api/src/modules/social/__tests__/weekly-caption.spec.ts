import { CAPTION_LIMIT } from '../social-caption';
import { buildWeeklyCaption, type CaptionEvent } from '../weekly-caption';

const TZ = 'America/New_York';

const event = (iso: string, title: string, over: Partial<CaptionEvent> = {}): CaptionEvent => ({
  title,
  startsAt: new Date(iso),
  room: 'Attic',
  free: false,
  blurb: null,
  ...over,
});

const base = {
  orgName: 'MaybeItsFate',
  window: 'Thu, Nov 26 – Sun, Dec 6',
  eventsUrl: 'https://maybeos.org/orgs/maybeitsfate/events',
  timeZone: TZ,
};

/**
 * The words under the weekly image (SOC-05).
 *
 * Charley: "Include a description with more text that explains in full each
 * event listed", and of the image, "If there are more events than can fit
 * with a readable font size, use the text description to include the rest."
 *
 * The caption is therefore the only place the whole week appears, which makes
 * silently dropping an event the failure that matters.
 */
describe('the weekly caption', () => {
  describe('an ordinary week', () => {
    const events = [
      event('2026-11-28T19:00:00Z', 'Unwrap Yourself'),
      event('2026-11-30T00:00:00Z', 'Sunday Game Club', { free: true, room: 'Back Room' }),
    ];

    it('names the co-op and the span', () => {
      const caption = buildWeeklyCaption({ ...base, events });

      expect(caption).toContain("What's on at MaybeItsFate");
      expect(caption).toContain('Thu, Nov 26 – Sun, Dec 6');
    });

    it('carries every event, with where and whether it is free', () => {
      const caption = buildWeeklyCaption({ ...base, events });

      expect(caption).toContain('Unwrap Yourself');
      expect(caption).toContain('Sunday Game Club');
      expect(caption).toContain('(Back Room · Free)');
    });

    /*
      The co-op's clock, not the server's. These are UTC instants and the API
      runs on a Lambda in UTC — 7pm UTC is 2pm in Louisville, and a caption
      that said 7pm would send people five hours late.
    */
    it('tells the time in the co-op’s own zone', () => {
      const caption = buildWeeklyCaption({ ...base, events });

      // 7pm UTC is 2pm in Louisville.
      expect(caption).toContain('Sat, Nov 28, 2 pm — Unwrap Yourself');

      /*
        And the sharper case: Game Club is stored as midnight on 30 November
        UTC, which is 7pm on the *29th* locally. Formatting without naming
        the zone would put it on the wrong day, not merely at the wrong hour
        — and "what's on this weekend" is the sentence that cannot be a day
        out.
      */
      expect(caption).toContain('Sun, Nov 29, 7 pm — Sunday Game Club');
      expect(caption).not.toContain('Nov 30');
    });

    it('ends with the co-op’s own call to action and the link', () => {
      const caption = buildWeeklyCaption({
        ...base,
        events,
        cta: 'Visit maybeitsfate.com/events for tickets and details!',
      });

      expect(caption).toContain('Visit maybeitsfate.com/events for tickets and details!');
      expect(caption.trimEnd().endsWith(base.eventsUrl)).toBe(true);
    });

    /** The same rule the image follows, and why both sort rather than trust. */
    it('is chronological whatever order it is handed', () => {
      const caption = buildWeeklyCaption({
        ...base,
        events: [
          event('2026-12-06T22:30:00Z', 'Last'),
          event('2026-11-28T19:00:00Z', 'First'),
        ],
      });

      expect(caption.indexOf('First')).toBeLessThan(caption.indexOf('Last'));
    });

    it('says something sensible for a week with nothing on', () => {
      const caption = buildWeeklyCaption({ ...base, events: [] });

      expect(caption).toContain("What's on at MaybeItsFate");
      expect(caption).toContain(base.eventsUrl);
    });
  });

  /**
   * Instagram's 2,200 characters are the binding constraint, and what gives
   * way under them is detail — never an event.
   */
  describe('when the week does not fit', () => {
    const many = (n: number, blurbLength = 0) =>
      Array.from({ length: n }, (_, i) =>
        event(`2026-11-${String(26 + (i % 4)).padStart(2, '0')}T19:00:00Z`, `Event number ${i}`, {
          blurb: blurbLength ? 'x'.repeat(blurbLength) : null,
        }),
      );

    it('gives up the blurbs before it gives up an event', () => {
      const events = many(14, 400);
      const caption = buildWeeklyCaption({ ...base, events });

      expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
      for (const e of events) expect(caption).toContain(e.title);
    });

    /*
      Past the point where even the bare list fits, it says how many are
      missing and where they are. An honest short caption beats a long one
      with a silent hole in it.
    */
    it('says how many are missing rather than quietly dropping them', () => {
      const events = many(60);
      const caption = buildWeeklyCaption({ ...base, events });

      expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
      expect(caption).toMatch(/and \d+ more/);
      expect(caption).toContain(base.eventsUrl);
    });

    it('never exceeds the limit it was given', () => {
      for (const n of [1, 5, 9, 20, 60, 200]) {
        for (const blurb of [0, 200]) {
          const caption = buildWeeklyCaption({ ...base, events: many(n, blurb) });
          expect(caption.length).toBeLessThanOrEqual(CAPTION_LIMIT);
        }
      }
    });

    /*
      The count in "and N more" has to agree with what is actually listed.
      Dropping one event can lengthen the note, so the builder walks down
      until it genuinely fits rather than computing a position once.
    */
    it('counts the ones it left out correctly', () => {
      const events = many(60);
      const caption = buildWeeklyCaption({ ...base, events });

      const claimed = Number(caption.match(/and (\d+) more/)![1]);
      const listed = events.filter((e) => caption.includes(e.title)).length;

      expect(listed + claimed).toBe(events.length);
    });

    /** Facebook allows far more, so it is given more rather than the same. */
    it('uses the whole budget when the budget is bigger', () => {
      const events = many(14, 400);

      const forInstagram = buildWeeklyCaption({ ...base, events });
      const forFacebook = buildWeeklyCaption({ ...base, events, limit: 5000 });

      expect(forFacebook.length).toBeGreaterThan(forInstagram.length);
      expect(forFacebook.length).toBeLessThanOrEqual(5000);
      // And the fuller one carries the events' own words.
      expect(forFacebook).toMatch(/x{50}/);
    });
  });
});
