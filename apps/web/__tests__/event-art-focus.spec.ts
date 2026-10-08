import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_FOCUS_Y, bandTopPct, focusStyle, focusY } from '@/lib/image-focus';

/**
 * Where an event's picture gets cropped (EVT-43).
 *
 * Charley, looking at the dashboard: "Ask the user to set the focus on the
 * image so we don't see heads cut off like this." JG Shadid's card showed him
 * from the shoulders down — `object-fit: cover` takes the middle, and the
 * middle of a photograph of a person is their chest.
 */
describe('reading a focus', () => {
  it('centres when nothing has been chosen', () => {
    // Which is exactly what every event looked like before this existed, so
    // nothing moves until somebody moves the slider.
    expect(focusY(undefined)).toBe(DEFAULT_FOCUS_Y);
    expect(focusY(null)).toBe(50);
    expect(focusStyle(undefined).objectPosition).toBe('50% 50%');
  });

  it('clamps what arrives from a database or a form', () => {
    expect(focusY(-20)).toBe(0);
    expect(focusY(140)).toBe(100);
    expect(focusY(Number.NaN)).toBe(50);
  });

  it('keeps the horizontal half centred', () => {
    // These frames are wider than the source, so nothing is lost sideways. A
    // second slider would be a control that changes nothing.
    expect(focusStyle(0).objectPosition).toBe('50% 0%');
    expect(focusStyle(100).objectPosition).toBe('50% 100%');
  });

  it('puts a face near the top when asked', () => {
    expect(focusStyle(20).objectPosition).toBe('50% 20%');
  });
});

describe('the band drawn on the preview', () => {
  it('sits flush with the top and the bottom rather than hanging over', () => {
    // The same arithmetic the Handbook's horizontal focus uses: the offset
    // spans only the room the band has left.
    expect(bandTopPct(0, 34)).toBe(0);
    expect(bandTopPct(100, 34)).toBe(66);
  });

  it('is halfway down at the default', () => {
    expect(bandTopPct(50, 34)).toBe(33);
  });
});

describe('where the focus is honoured', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

  const sites: Array<[string, string]> = [
    ['the event card', read('components', 'events', 'event-cards.tsx')],
    [
      'the event page',
      read('app', '(app)', 'portal', '[orgSlug]', 'events', '[eventSlug]', 'page.tsx'),
    ],
  ];

  it.each(sites)('%s crops where the host chose', (_name, source) => {
    /*
      Every frame an event's art appears in is wider than it is tall, so each
      one crops vertically and each one has to be told. A site that forgets is
      a card that still cuts the head off, and it looks like the slider is
      broken rather than unread.
    */
    // Each `<img>` whose source is the event's art, and whether that same tag
    // was told where to crop. Counting `object-cover` across the file would
    // fail the day somebody adds an avatar to it, which is noise rather than a
    // guard.
    const tags = source.match(/<img[\s\S]{0,400}?\/>/g) ?? [];
    const artTags = tags.filter((tag) => /src=\{eventArt\(/.test(tag));

    expect(artTags.length).toBeGreaterThan(0);
    for (const tag of artTags) {
      expect(tag).toMatch(/style=\{focusStyle\(/);
    }
  });

  it('is asked for only once there is a picture to aim at', () => {
    // The drawn fallback art is generated to fit and has no subject to miss.
    const form = read('components', 'events', 'event-form.tsx');
    expect(form).toMatch(/image\.imageUrl && \(\s*<EventArtFocus/);
  });

  it('is sent with the rest of the form', () => {
    expect(read('components', 'events', 'event-form.tsx')).toMatch(/imageFocusY: focusYValue/);
  });

  it('shows the card’s real shape, not a square', () => {
    // A preview that is not the real shape is how somebody sets a focus that
    // looks right in the editor and wrong on the card.
    const control = read('components', 'events', 'event-art-focus.tsx');
    expect(control).toMatch(/h-20 w-56[^"]*object-cover/);
    expect(control).toMatch(/How the card will look/);
  });
});
