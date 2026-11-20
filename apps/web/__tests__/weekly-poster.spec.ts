import {
  CTA_LIMIT,
  DEFAULT_CTA,
  MAX_ROWS,
  POSTER_HEIGHT,
  POSTER_WIDTH,
  WORDMARK_ASPECT,
  logoBox,
  posterPalette,
  splitForPoster,
  windowLabel,
  type PosterEvent,
} from '@/lib/weekly-poster';
import { contrast } from '@/lib/brand';

const at = (iso: string, title = 'A thing'): PosterEvent => ({
  title,
  startsAt: new Date(iso),
  room: null,
  free: false,
});

/**
 * The weekly poster's decisions (SOC-05).
 *
 * Everything here is settled without rendering anything, which is the point:
 * the renderer draws what this says, and the caption carries what this leaves
 * out, so the two cannot disagree about which events made it onto the image.
 */
describe('the weekly poster', () => {
  describe('the shape Instagram will accept', () => {
    it('is 4:5, the tallest feed image that is not cropped', () => {
      expect(POSTER_WIDTH).toBe(1080);
      expect(POSTER_HEIGHT).toBe(1350);
      expect(POSTER_WIDTH / POSTER_HEIGHT).toBeCloseTo(0.8, 5);
    });
  });

  describe('what fits, and what goes to the caption', () => {
    /*
      Eight is not a wish. It falls out of the row height, which falls out of
      the chip and the padding the renderer actually draws with. The first
      version guessed 118px, the real pitch was 114, and the overflow line
      printed on top of the footer.
    */
    it('fits eight events', () => {
      expect(MAX_ROWS).toBe(8);
    });

    it('shows them all when they all fit', () => {
      const events = Array.from({ length: 8 }, (_, i) => at(`2026-11-2${i % 9}T10:00:00`));
      const { shown, overflow } = splitForPoster(events);

      expect(shown).toHaveLength(8);
      expect(overflow).toHaveLength(0);
    });

    it('sends the rest to the caption rather than shrinking the type', () => {
      const events = Array.from({ length: 12 }, (_, i) => at('2026-11-26T10:00:00', `E${i}`));
      const { shown, overflow } = splitForPoster(events);

      expect(shown).toHaveLength(8);
      expect(overflow).toHaveLength(4);
      // Nothing is lost between the two.
      expect([...shown, ...overflow]).toHaveLength(12);
    });

    /** "Always list events in chronological order." */
    it('puts them in time order whatever order they arrive in', () => {
      const { shown } = splitForPoster([
        at('2026-12-06T17:30:00', 'last'),
        at('2026-11-28T14:00:00', 'first'),
        at('2026-12-01T18:30:00', 'middle'),
      ]);

      expect(shown.map((e) => e.title)).toEqual(['first', 'middle', 'last']);
    });

    it('sorts before it splits, so the caption never holds an earlier event', () => {
      const events = [
        at('2026-12-20T10:00:00', 'late'),
        ...Array.from({ length: 8 }, (_, i) => at(`2026-11-0${i + 1}T10:00:00`, `early${i}`)),
      ];
      const { shown, overflow } = splitForPoster(events);

      expect(overflow.map((e) => e.title)).toEqual(['late']);
      expect(shown.every((e) => e.startsAt < overflow[0].startsAt)).toBe(true);
    });

    it('is unbothered by a week with nothing on', () => {
      expect(splitForPoster([])).toEqual({ shown: [], overflow: [] });
    });
  });

  /**
   * A logo is somebody's mark. It is shown whole or not at all.
   *
   * MaybeItsFate's is 8497×1409 — an aspect of six, because it is a wordmark.
   * The first version put every logo in a 72×72 `cover` box, which cropped it
   * to the first glyph and a half and then set the name beside it in Archivo,
   * breaking the standing rule twice over.
   */
  describe('placing a logo', () => {
    it('gives a wordmark the room to be read, and does not repeat the name', () => {
      const box = logoBox(8497 / 1409);

      expect(box.isWordmark).toBe(true);
      expect(box.width).toBe(458);
      expect(box.height).toBe(76);
      // The aspect is kept: nothing is squashed and nothing is cropped.
      expect(box.width / box.height).toBeCloseTo(8497 / 1409, 1);
    });

    it('sets an emblem beside the name instead', () => {
      const box = logoBox(1);

      expect(box.isWordmark).toBe(false);
      expect(box).toMatchObject({ width: 76, height: 76 });
    });

    it('gives height away rather than crop an extremely wide mark', () => {
      const box = logoBox(12);

      expect(box.width).toBeLessThanOrEqual(620);
      // Within a pixel's worth of rounding: the height is a whole number, so
      // a 12:1 mark lands at 620x52, which is 11.92:1.
      expect(box.width / box.height).toBeCloseTo(12, 0);
    });

    it('keeps a tall logo whole too', () => {
      const box = logoBox(0.5);
      expect(box).toMatchObject({ width: 38, height: 76 });
    });

    it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
      'treats a nonsense aspect (%s) as square rather than drawing nothing',
      (aspect) => {
        expect(logoBox(aspect as number)).toMatchObject({ width: 76, height: 76 });
      },
    );

    it('draws the line between a mark and a wordmark at a readable place', () => {
      expect(logoBox(WORDMARK_ASPECT).isWordmark).toBe(true);
      expect(logoBox(WORDMARK_ASPECT - 0.01).isWordmark).toBe(false);
    });
  });

  /**
   * Any co-op's colour has to work, including the ones that are nearly black.
   *
   * The lightening is `brandTheme`'s, which is what the app itself uses, so a
   * poster cannot disagree with the co-op's own pages.
   */
  describe('colours', () => {
    it.each([
      ['a pale blue', '#afd2e9'],
      ['a near-black navy', '#1f3a5f'],
      ['pure black', '#000000'],
      ['a hot pink', '#ff2d9b'],
    ])('keeps the text readable on %s', (_label, brand) => {
      const c = posterPalette(brand);

      expect(contrast(c.background, c.ink)).toBeGreaterThanOrEqual(4.5);
      // And on the chip, where the colour is at full strength.
      expect(contrast(c.accent, c.accentInk)).toBeGreaterThanOrEqual(4.5);
    });

    it('falls back to the MaybeOS palette for a co-op that never chose one', () => {
      const c = posterPalette(null);
      expect(contrast(c.background, c.ink)).toBeGreaterThanOrEqual(4.5);
    });
  });

  /**
   * What the co-op wants people to do, in their own words.
   *
   * Charley: "Ask the admin what the CTA should read on the image, and
   * provide a cap on the amount of text." His own is 54 characters.
   */
  describe('the call to action', () => {
    it('leaves room for the example that prompted it, and then some', () => {
      const charleys = 'Visit maybeitsfate.com/events for tickets and details!';

      expect(charleys).toHaveLength(54);
      expect(CTA_LIMIT).toBeGreaterThan(charleys.length);
      expect(CTA_LIMIT).toBe(80);
    });

    /*
      The cap is on what a co-op can type, not a promise about width. Eighty
      capital Ws are wider than the poster and used to run off both edges, so
      the footer wraps and breaks long words — the cap is what keeps that from
      ever being what anybody sees.
    */
    it('is a limit on characters, which cannot bound a width on its own', () => {
      expect('W'.repeat(CTA_LIMIT)).toHaveLength(80);
      // The renderer is what has to cope; this records why it must.
      expect(CTA_LIMIT * 26).toBeGreaterThan(POSTER_WIDTH);
    });

    it('has something to say for a co-op that has not written one', () => {
      expect(DEFAULT_CTA).toMatch(/Everyone welcome/);
      expect(DEFAULT_CTA.length).toBeLessThanOrEqual(CTA_LIMIT);
    });
  });

  describe('the window', () => {
    it('reads as the span the post covers', () => {
      expect(windowLabel(new Date('2026-11-26T00:00:00'), new Date('2026-12-06T23:59:00'))).toBe(
        'Thu, Nov 26 – Sun, Dec 6',
      );
    });
  });
});
