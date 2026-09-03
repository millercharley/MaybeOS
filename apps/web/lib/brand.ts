/**
 * A co-op's own colour, applied without making its pages unreadable (BRD-01).
 *
 * Charley asked for the brand colour to be the background of member pages.
 * MaybeItsFate's is `#afd2e9`, a pale blue, and reads beautifully — but the
 * field's *default* is `#6366f1`, a saturated indigo, and a co-op can pick
 * anything at all. A page painted a colour chosen for a logo is only legible
 * by luck.
 *
 * So the colour is taken as given and everything else is derived from it: the
 * text flips between ink and paper on whichever gives the better contrast, and
 * borders are drawn from the same colour rather than from a fixed grey that
 * would fight it.
 */

/** The palette's own ink and paper, which the derived theme picks between. */
const INK = '#211c16';
const PAPER = '#f3eee1';

export interface BrandTheme {
  /** The page behind everything: the co-op's colour, lightened if it must be. */
  background: string;
  /** The colour as the co-op set it, before any lightening. */
  brand: string;
  /** True when the colour was too dark for the headline and was lightened. */
  lightened: boolean;
}

/** `#abc` or `#aabbcc`, with or without the hash. Null if it is not a colour. */
export function parseHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().replace(/^#/, '');
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null;
  const full =
    value.length === 3
      ? value.split('').map((c) => c + c).join('')
      : value;
  return `#${full.toLowerCase()}`;
}

function channels(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Relative luminance, per WCAG.
 *
 * Not the naive average of the channels: the eye is far more sensitive to
 * green than to blue, and averaging calls `#0000ff` mid-bright when it is
 * nearly black to read against.
 */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1 (same) to 21 (black/white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Contrast the page headline needs against the background it sits on.
 *
 * 4.5:1 is WCAG AA for body text.
 */
const MIN_CONTRAST = 4.5;

/** `a` mixed toward `b` by `amount` (0 = all a, 1 = all b). */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const at = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return (
    '#' +
    [at(ar, br), at(ag, bg), at(ab, bb)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * The theme for one co-op's colour, or null when it has not set one.
 *
 * **Only the page headline sits on this colour.** Everything else runs in
 * panels and cards (BRD-02), which is what makes a co-op's choice safe — as
 * Charley put it, "it doesn't matter what color an admin picks, everything
 * remains readable inside the panels and cards." The Members page is the
 * shape: title and its buttons on the background, every other word on a card.
 *
 * The headline is the exception, so the background is lightened just far
 * enough for the app's own ink to read against it. MaybeItsFate's `#afd2e9`
 * clears the threshold untouched, which is the case that matters; a co-op that
 * picks near-black gets a pale version rather than an invisible title.
 *
 * An earlier version flipped the *text* to light instead. It read correctly in
 * the abstract and failed in the product: the title is `text-ink` and the
 * buttons are `.btn-secondary`, both compiled to fixed colours that a CSS
 * variable cannot reach.
 *
 * Null rather than a default, so a co-op that has never opened the Branding
 * tab keeps the MaybeOS palette.
 */
export function brandTheme(brandColor: string | null | undefined): BrandTheme | null {
  const brand = parseHex(brandColor);
  if (!brand) return null;

  let background = brand;
  let lightened = false;

  for (let i = 1; i <= 20 && contrast(background, INK) < MIN_CONTRAST; i += 1) {
    background = mix(brand, PAPER, i * 0.05);
    lightened = true;
  }

  return { background, brand, lightened };
}

export function brandStyle(theme: BrandTheme | null): Record<string, string> {
  if (!theme) return {};
  // Only the page behind everything. Cards, type and controls keep the MaybeOS
  // palette, which is what makes this safe for any colour — and what stopped
  // the first attempt from working.
  return {
    backgroundColor: theme.background,
    '--paper': theme.background,
  };
}
