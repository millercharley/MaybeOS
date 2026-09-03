import { defaultEventArt, eventArt } from '@/lib/event-art';

/**
 * Every event has a picture (EVT-18).
 *
 * A list where half the cards have art and half have a grey rectangle reads as
 * broken rather than sparse — and the ones with no image are exactly the
 * events nobody fussed over, which is the ten-second publish EVT-17 exists to
 * encourage.
 */
const event = (over: Partial<Parameters<typeof defaultEventArt>[0]> = {}) => ({
  id: 'evt-1',
  title: 'Figure drawing',
  ...over,
});

describe('defaultEventArt', () => {
  it('produces an image that needs no network', () => {
    // A data URI renders in an email client that will not load remote images,
    // and needs no bucket, no request and no signing.
    expect(defaultEventArt(event())).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('is stable for the same event', () => {
    // Art that changes on every render is worse than no art.
    expect(defaultEventArt(event())).toBe(defaultEventArt(event()));
  });

  it('differs between events', () => {
    expect(defaultEventArt(event({ id: 'a' }))).not.toBe(defaultEventArt(event({ id: 'b' })));
  });

  it('names the room when one is booked', () => {
    const art = decodeURIComponent(defaultEventArt(event({ roomName: '3rd Floor Attic' })));

    expect(art).toContain('3rd Floor Attic');
  });

  it('falls back to the kind of gathering when there is no room', () => {
    const art = decodeURIComponent(defaultEventArt(event({ tags: ['Art or expression'] })));

    expect(art).toContain('Art or expression');
  });

  it('prefers the room over the kind', () => {
    // The room is the more specific thing, and the one somebody has to find.
    const art = decodeURIComponent(
      defaultEventArt(event({ roomName: 'Attic', tags: ['Social'] })),
    );

    expect(art).toContain('Attic');
    expect(art).not.toContain('Social');
  });

  it('still draws something for an event with nothing said about it', () => {
    const art = decodeURIComponent(defaultEventArt(event()));

    expect(art).toContain('<svg');
    expect(art).not.toContain('undefined');
    expect(art).not.toContain('null');
  });

  it('escapes a title that would break the SVG', () => {
    const art = decodeURIComponent(
      defaultEventArt(event({ roomName: 'Rock & Roll <Room>' })),
    );

    expect(art).toContain('Rock &amp; Roll &lt;Room&gt;');
  });

  it('gives the same kind of gathering the same palette', () => {
    const a = decodeURIComponent(defaultEventArt(event({ id: 'a', tags: ['Social'] })));
    const b = decodeURIComponent(defaultEventArt(event({ id: 'b', tags: ['Social'] })));

    expect(a).toContain('#ec4899');
    expect(b).toContain('#ec4899');
  });
});

describe('eventArt', () => {
  it('uses the event\'s own image when it has one', () => {
    expect(eventArt({ ...event(), imageUrl: 'https://example.org/poster.jpg' })).toBe(
      'https://example.org/poster.jpg',
    );
  });

  it('draws one when it does not', () => {
    expect(eventArt({ ...event(), imageUrl: null })).toMatch(/^data:image\/svg/);
    expect(eventArt({ ...event(), imageUrl: '' })).toMatch(/^data:image\/svg/);
  });
});
