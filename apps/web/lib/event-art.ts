/**
 * A picture for every event, whether or not somebody uploaded one (EVT-18).
 *
 * A list where half the cards have art and half have a grey rectangle reads as
 * broken rather than sparse, and the events with no image are exactly the ones
 * nobody has fussed over — a member publishing a room booking in ten seconds,
 * which is the flow EVT-17 exists to encourage. Making them look neglected
 * would punish the thing we just made easy.
 *
 * Drawn rather than fetched: a stock photo library is a licensing question and
 * a network dependency, and a gradient with the room or the kind of gathering
 * written into it says more about *this* event than a picture of somebody
 * else's workshop.
 */

/** Deterministic, so the same event keeps the same art on every render. */
function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Palettes by kind of gathering, matched to what the booking form asks.
 *
 * Deliberately not one palette per category with a fallback to grey: an
 * uncategorised event is the common case, and it should look like an event
 * rather than like a missing value.
 */
const PALETTES: Record<string, [string, string]> = {
  'Art or expression': ['#c2410c', '#f59e0b'],
  'Organising or meetings': ['#1e3a5f', '#3b82f6'],
  Social: ['#7c2d55', '#ec4899'],
  Learning: ['#166534', '#65a30d'],
  'Rehearsal or practice': ['#4c1d95', '#8b5cf6'],
  'Care or support': ['#155e63', '#14b8a6'],
};

const FALLBACKS: [string, string][] = [
  ['#3f3f46', '#71717a'],
  ['#1e3a5f', '#3b82f6'],
  ['#4c1d95', '#8b5cf6'],
  ['#166534', '#65a30d'],
];

export interface ArtSubject {
  id: string;
  title: string;
  /** Kinds of gathering, from the booking that published it. */
  tags?: string[] | null;
  category?: string | null;
  /** The room, when one is booked — the most specific thing we can say. */
  roomName?: string | null;
}

/**
 * An SVG data URI for an event with no image of its own.
 *
 * A data URI rather than a file, so it needs no request, no storage bucket and
 * no signing — and it renders identically in an email client that will not
 * load remote images.
 */
export function defaultEventArt(event: ArtSubject): string {
  const kind = event.tags?.[0] ?? event.category ?? null;
  const [from, to] =
    (kind && PALETTES[kind]) ?? FALLBACKS[hash(event.id) % FALLBACKS.length];

  // The room if there is one, else the kind, else nothing — a caption
  // repeating the title directly underneath it is noise.
  const caption = event.roomName ?? kind ?? '';
  const angle = hash(event.title) % 60;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
<defs><linearGradient id="g" gradientTransform="rotate(${angle})">
<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
</linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/>
<circle cx="${100 + (hash(event.id) % 440)}" cy="${60 + (hash(event.title) % 240)}" r="150" fill="#ffffff" opacity="0.08"/>
${
  caption
    ? // Centred rather than in a corner: every surface crops this with
      // `object-cover`, at aspect ratios from a wide hero to a small
      // thumbnail, and a caption in the corner is the first thing cut.
      `<text x="320" y="196" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="30" font-weight="600" fill="#ffffff" opacity="0.9">${escapeXml(caption)}</text>`
    : ''
}
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The event's own image, or art drawn for it. */
export function eventArt(
  event: ArtSubject & { imageUrl?: string | null },
): string {
  return event.imageUrl || defaultEventArt(event);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
