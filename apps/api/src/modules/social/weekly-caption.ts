import { CAPTION_LIMIT } from './social-caption';

/**
 * The words under the weekly image (SOC-05).
 *
 * Charley: "Include a description with more text that explains in full each
 * event listed" — and, of the image, "If there are more events than can fit
 * with a readable font size, use the text description to include the rest."
 *
 * So the caption is where the whole week lives. The image shows eight; this
 * names every one, and it is the only place a reader can see the ones that
 * did not fit. That makes its failure mode the important thing: a caption
 * that silently drops the ninth event defeats the arrangement.
 *
 * ## Instagram's 2,200 characters are the binding constraint
 *
 * Facebook's limit is far higher, so the same builder is given a different
 * budget per platform rather than written twice. Within a budget it gives up
 * detail before it gives up events, in this order:
 *
 *   1. every event with its own blurb
 *   2. every event, headline only
 *   3. as many as fit, and a line saying where the rest are
 *
 * An event's own words go first because they are what makes somebody come;
 * the listing goes last because a name and a time is still useful and a
 * missing event is not.
 */

export interface CaptionEvent {
  title: string;
  /** The UTC instant, formatted into the co-op's timezone below. */
  startsAt: Date;
  room: string | null;
  free: boolean;
  /** The event's description, already plain text. */
  blurb: string | null;
}

export interface CaptionInput {
  orgName: string;
  window: string;
  events: CaptionEvent[];
  /** Where the whole calendar lives, for the tail. */
  eventsUrl: string;
  /** The admin's own call to action, as it appears on the image. */
  cta?: string | null;
  limit?: number;
  /**
   * The co-op's timezone, named rather than inherited.
   *
   * Every event is a UTC instant and this runs on a Lambda whose clock is
   * UTC, so formatting without naming the zone prints the wrong time for
   * every co-op on earth that is not in London in winter. SPC-08 is the card
   * about the same mistake in booking emails.
   */
  timeZone: string;
}

/** How much of an event's own description the caption will carry. */
const BLURB_CHARS = 110;

const when = (d: Date, timeZone: string) =>
  `${d.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' })}, ` +
  d
    .toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .toLowerCase();

function headline(e: CaptionEvent, timeZone: string): string {
  const where = [e.room, e.free ? 'Free' : null].filter(Boolean).join(' · ');
  return `${when(e.startsAt, timeZone)} — ${e.title}${where ? ` (${where})` : ''}`;
}

function trimTo(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max - 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Chronological, always — the same rule the image follows, and the reason
 * both sort rather than trusting the order they were handed.
 */
export function buildWeeklyCaption(input: CaptionInput): string {
  const limit = input.limit ?? CAPTION_LIMIT;
  const events = [...input.events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const head = `What's on at ${input.orgName}\n${input.window}`;
  const tailParts = [input.cta?.trim() || null, input.eventsUrl].filter(Boolean) as string[];
  const tail = tailParts.join('\n');

  if (events.length === 0) return `${head}\n\n${tail}`;

  const assemble = (lines: string[], note?: string) =>
    [head, '', ...lines, ...(note ? ['', note] : []), '', tail].join('\n');

  // 1 — everything, with each event's own words.
  const withBlurbs = events.map((e) => {
    const blurb = e.blurb ? trimTo(e.blurb, BLURB_CHARS) : '';
    const line = headline(e, input.timeZone);
    return blurb ? `${line}\n${blurb}` : line;
  });
  const full = assemble(withBlurbs);
  if (full.length <= limit) return full;

  // 2 — everything, headlines only. Still the whole week.
  const headlines = events.map((e) => headline(e, input.timeZone));
  const listed = assemble(headlines);
  if (listed.length <= limit) return listed;

  /*
    3 — as many as fit, and an honest line about the rest.

    Counted from the end rather than guessed: the note's own length depends
    on how many are left out, so dropping one event can make the note longer
    and the caption no shorter. This walks down until it genuinely fits.
  */
  for (let shown = headlines.length - 1; shown >= 1; shown -= 1) {
    const left = events.length - shown;
    const note = `and ${left} more — the full list is at ${input.eventsUrl}`;
    const attempt = assemble(headlines.slice(0, shown), note);
    if (attempt.length <= limit) return attempt;
  }

  // Even one event and the tail is over budget: say where everything is and
  // stop. Better a short true caption than a long truncated one.
  return trimTo(`${head}\n\n${events.length} events this week — ${input.eventsUrl}`, limit);
}
