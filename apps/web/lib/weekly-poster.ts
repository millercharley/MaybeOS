import { brandTheme, contrast } from '@/lib/brand';

/**
 * What fits on the weekly poster, and what spills into the caption (SOC-05).
 *
 * The decisions, with no drawing in them, so they can be tested without
 * rendering anything. Charley's rule: "List all events that are public. If
 * there are more events than can fit with a readable font size, use the text
 * description to include the rest." So this answers one question — how many
 * rows fit — and the renderer and the caption both obey the same answer
 * rather than each guessing.
 */

/** Instagram's tallest feed image. Anything taller is cropped by Instagram. */
export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

/**
 * The band at the top and the line at the bottom, in pixels.
 *
 * These are measured from the rendered poster, not guessed. The first version
 * guessed, the guess was 12px per row short, and the overflow line printed on
 * top of the footer — so they are derived from the same numbers the renderer
 * draws with, and a test pins them together.
 */
const HEADER = 268;
const FOOTER = 150;

/**
 * One row, and the gap under it.
 *
 * Chosen from the smallest type that stays readable in a feed, not from how
 * many events we wish would fit: a 32px title on a 1080px-wide image is about
 * 16px on a phone, which is ordinary body text. Making this smaller to fit one
 * more event is how a poster becomes a wall of grey.
 *
 * The card is the taller of its chip and its two lines of text, plus padding;
 * the renderer uses exactly these numbers.
 */
export const CHIP = 74;
export const CARD_PADDING_Y = 14;
export const ROW_GAP = 12;
const ROW = CHIP + CARD_PADDING_Y * 2 + ROW_GAP;

/** How many events the image can show before the rest belong in the caption. */
export const MAX_ROWS = Math.floor((POSTER_HEIGHT - HEADER - FOOTER) / ROW);

/**
 * The admin's call to action, and why it is capped.
 *
 * Charley: "Ask the admin what the CTA should read on the image, and provide
 * a cap on the amount of text. Example, for MaybeItsFate, I want people to
 * know: 'Visit maybeitsfate.com/events for tickets and details!'" — which is
 * 53 characters.
 *
 * 80 is two comfortable lines at the footer's size, which is as much as can
 * be read at a glance in a feed before it stops being a call to action and
 * starts being a paragraph. It is a cap on what a co-op can type, not a
 * promise the renderer makes: a string of 80 capital Ws is wider than any
 * character count can predict, so the footer truncates as a last resort and
 * the limit exists to make that never happen in practice.
 */
export const CTA_LIMIT = 80;

/** What the footer says when a co-op has not written one. */
export const DEFAULT_CTA = 'Everyone welcome \u00b7 details and RSVP in the caption';

export interface PosterEvent {
  title: string;
  /** Already in the co-op's own timezone — this file does no conversion. */
  startsAt: Date;
  room: string | null;
  free: boolean;
}

/**
 * The split, in chronological order.
 *
 * Sorted here rather than trusted from the caller, because "always list
 * events in chronological order" is the rule and a sort in one place is
 * cheaper than a bug in two.
 */
export function splitForPoster<T extends PosterEvent>(
  events: T[],
  maxRows = MAX_ROWS,
): { shown: T[]; overflow: T[] } {
  const inOrder = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  /*
    One row is never worth an "and 1 more". If the overflow would be a single
    event, drop a shown one so it reads "and 2 more" — no: that is worse. Show
    it instead by letting the last row carry it only when it genuinely fits.
    With maxRows rows available and maxRows + 1 events, the honest answer is
    that one does not fit, and the caption carries it. Kept explicit so nobody
    later "fixes" the off-by-one in the wrong direction.
  */
  return { shown: inOrder.slice(0, maxRows), overflow: inOrder.slice(maxRows) };
}

export interface PosterPalette {
  /** Behind everything. The co-op's colour, lightened until ink reads on it. */
  background: string;
  /** The co-op's colour as they set it, for chips and rules. */
  accent: string;
  /** Text on `background`. */
  ink: string;
  /** Text on `accent`. */
  accentInk: string;
  /** The card each event sits on. */
  card: string;
}

const INK = '#211c16';
const PAPER = '#fbf9f4';

/**
 * The poster's colours, derived from whatever the co-op chose.
 *
 * `brandTheme` already solves the hard half — it lightens a colour until the
 * headline reads on it — and is what the app itself uses, so a poster cannot
 * disagree with the co-op's own pages. What is added here is the chip: text
 * sitting *on* the brand colour at full strength, which `brandTheme` never
 * has to answer because the app only ever uses the colour behind things.
 */
export function posterPalette(brandColor: string | null | undefined): PosterPalette {
  const theme = brandTheme(brandColor);
  if (!theme) {
    return { background: PAPER, accent: INK, ink: INK, accentInk: PAPER, card: '#ffffff' };
  }

  return {
    background: theme.background,
    accent: theme.brand,
    ink: INK,
    // Whichever of ink or paper reads better on the colour at full strength.
    accentInk: contrast(theme.brand, INK) >= contrast(theme.brand, PAPER) ? INK : PAPER,
    card: '#ffffff',
  };
}

/**
 * "Thu, Nov 26 – Sun, Dec 6", the window the post covers.
 *
 * The timezone is named rather than inherited. Every date here is a UTC
 * instant and this renders on a server whose clock is UTC, so formatting
 * without naming the zone prints the wrong day for any co-op far enough east
 * or west — and "what's on this Thursday" is exactly the sentence that must
 * not be a day out.
 */
export function windowLabel(from: Date, to: Date, timeZone: string): string {
  const day = (d: Date) =>
    d.toLocaleDateString('en-US', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  return `${day(from)} – ${day(to)}`;
}

/**
 * How to place a co-op's logo, from its shape alone.
 *
 * MaybeItsFate's is 8497×1409 — an aspect of 6, because it is a wordmark: the
 * name, set as artwork. The first version put every logo in a 72×72 box with
 * `objectFit: cover`, which cropped that to the first glyph and a half and
 * printed the name beside it in Archivo. Charley's standing rule is that a
 * wordmark is rendered from its own asset and never redrawn as text, and this
 * managed to do both wrongs at once.
 *
 * So the shape decides. A wide logo already says the name and is given the
 * room to say it; a square-ish mark is an emblem and sits beside the name.
 * Nothing is ever cropped: the height gives way when the width would not fit.
 */
export const WORDMARK_ASPECT = 2.5;
const LOGO_HEIGHT = 76;
const LOGO_MAX_WIDTH = 620;

export interface LogoBox {
  width: number;
  height: number;
  /** True when the logo carries the name, so the name is not set beside it. */
  isWordmark: boolean;
}

export function logoBox(aspect: number): LogoBox {
  // A broken or unreadable image reports nothing useful; treat it as square
  // rather than dividing by zero and drawing a logo a million pixels wide.
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const isWordmark = ratio >= WORDMARK_ASPECT;

  let height = LOGO_HEIGHT;
  let width = Math.round(height * ratio);

  if (width > LOGO_MAX_WIDTH) {
    width = LOGO_MAX_WIDTH;
    height = Math.round(width / ratio);
  }

  return { width, height, isWordmark };
}
