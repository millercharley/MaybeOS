import { brandTheme, brandStyle, parseHex, contrast, luminance } from '@/lib/brand';

/**
 * A co-op's colour, applied without making its pages unreadable (BRD-01).
 *
 * MaybeItsFate's brand colour is a pale blue and would read fine however this
 * was written. The field's default is a saturated indigo, and a co-op can pick
 * black. These tests are about the colours nobody thought about.
 */
describe('parseHex', () => {
  it('accepts the shapes people paste', () => {
    expect(parseHex('#AFD2E9')).toBe('#afd2e9');
    expect(parseHex('afd2e9')).toBe('#afd2e9');
    expect(parseHex('#abc')).toBe('#aabbcc');
  });

  it('refuses anything that is not a colour', () => {
    expect(parseHex('blue')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('')).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(parseHex(undefined)).toBeNull();
  });
});

describe('luminance', () => {
  it('is not the average of the channels', () => {
    // Pure blue and pure green have identical channel averages and wildly
    // different brightness. Averaging would call blue mid-bright when it is
    // nearly black to read against.
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#0000ff') * 8);
  });

  it('runs from black to white', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('brandTheme', () => {
  it('keeps the MaybeOS palette when a co-op has set no colour', () => {
    // Null rather than a default: a co-op that never opened the Branding tab
    // should not be given somebody else's idea of a brand.
    expect(brandTheme(null)).toBeNull();
    expect(brandTheme('')).toBeNull();
    expect(brandTheme('not a colour')).toBeNull();
  });

  it("uses MaybeItsFate's pale blue exactly as they set it", () => {
    // The case that matters most: a co-op that picked a sensible background
    // colour gets that colour, untouched.
    const theme = brandTheme('#afd2e9')!;
    expect(theme.background).toBe('#afd2e9');
    expect(theme.lightened).toBe(false);
  });

  it('lightens a colour too dark for the app\'s own text', () => {
    // The first version of this flipped the text to light instead. It read
    // correctly in the abstract and failed in the product: the page title is
    // `text-ink` and the buttons are `.btn-secondary`, both fixed colours a
    // CSS variable cannot reach, so a member got an invisible heading. The
    // background comes to the text now.
    const theme = brandTheme('#1a1a2e')!;
    expect(theme.lightened).toBe(true);
    expect(theme.brand).toBe('#1a1a2e');
    expect(theme.background).not.toBe('#1a1a2e');
    expect(contrast(theme.background, '#211c16')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every colour readable against the ink the app actually uses', () => {
    // The property, over the colours a co-op might plausibly choose plus the
    // field's own default.
    const colours = ['#6366f1', '#afd2e9', '#000000', '#ffffff', '#808080',
                     '#c81e2c', '#4b5e3a', '#1a1a2e', '#2d0a31'];
    for (const c of colours) {
      const theme = brandTheme(c)!;
      expect(contrast(theme.background, '#211c16')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lightens only as far as it has to', () => {
    // A colour that only just fails should be barely touched, not washed out.
    const theme = brandTheme('#9ab7cf')!;
    if (theme.lightened) {
      expect(contrast(theme.background, '#211c16')).toBeLessThan(6);
    }
  });

  it('remembers the colour the co-op chose', () => {
    expect(brandTheme('#1a1a2e')!.brand).toBe('#1a1a2e');
  });

});

describe('brandStyle', () => {
  it('is empty when there is no theme, so nothing is overridden', () => {
    expect(brandStyle(null)).toEqual({});
  });

  it('paints the page and nothing else', () => {
    // Cards, type and controls keep the MaybeOS palette. Overriding those was
    // the first attempt, and it is what broke on a dark colour.
    const style = brandStyle(brandTheme('#afd2e9'));
    expect(style.backgroundColor).toBe('#afd2e9');
    expect(style['--paper']).toBe('#afd2e9');
    expect(style.color).toBeUndefined();
    expect(style['--ink']).toBeUndefined();
  });
});
