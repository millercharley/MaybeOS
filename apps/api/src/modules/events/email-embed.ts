/**
 * The events embed, for an email campaign (EVT-55).
 *
 * Charley pasted the website embed into MailerLite and got nothing. That is
 * what a `<script>` tag does in an email: every client strips it, and the
 * ones that do not have no DOM to run it against. The website embed is not
 * at fault and is deliberately not touched — this is a second way out of the
 * same data, shaped for the one medium that cannot run code.
 *
 * So: an RSS feed whose single item carries a block of email-safe HTML in a
 * CDATA section, which is the shape MailerLite and the rest of them know how
 * to drop into a campaign.
 *
 * **Email-safe means 2003.** No grid, no flexbox, no `<style>` block, no
 * classes, no script. Nested tables, explicit cell padding and inline styles
 * on every element, because Outlook renders through Word and Gmail throws
 * away anything in a head it never had. Every rule here exists because some
 * client ignores the modern version of it.
 *
 * It still has to *look* like the website embed, which is why the colour
 * maths, the countdown wording, the excerpt clipping and the button copy are
 * ported rather than reinvented. Where the two must differ, they differ for a
 * reason stated at the point it happens.
 */

/* ───────────────────────── colour ───────────────────────── */

function rgbOf(hex: string): [number, number, number] | null {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function luminance(c: [number, number, number]): number {
  const channel = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

function toHex(c: number[]): string {
  return (
    '#' +
    c
      .map((v) => {
        const h = Math.round(v).toString(16);
        return h.length === 1 ? '0' + h : h;
      })
      .join('')
  );
}

/** The co-op's colour when nothing else is set, matching the website embed. */
export const DEFAULT_ACCENT = '#b03030';

/**
 * Text laid *on* the accent — the filled button's label.
 *
 * 0.179 is where white and black are equally readable against a colour. A
 * co-op with a pale brand colour was getting white on pale, which is a
 * button nobody can read.
 */
export function onAccent(hex: string): string {
  const rgb = rgbOf(hex);
  if (!rgb) return '#ffffff';
  return luminance(rgb) > 0.179 ? '#1a1a1a' : '#ffffff';
}

/**
 * The accent used *as* text on white — dates, prices.
 *
 * Darkened by steps until it clears WCAG 4.5:1 against white, keeping the
 * hue, which is the point of inheriting a co-op's colour at all. A pale
 * brand colour at 14px on white is a decoration, not a date.
 */
export function accentText(hex: string): string {
  const rgb = rgbOf(hex);
  if (!rgb) return DEFAULT_ACCENT;
  for (let f = 1; f >= 0.1; f -= 0.05) {
    const scaled: [number, number, number] = [rgb[0] * f, rgb[1] * f, rgb[2] * f];
    if (1.05 / (luminance(scaled) + 0.05) >= 4.5) return toHex(scaled);
  }
  return '#1a1a1a';
}

/* ───────────────────────── escaping ───────────────────────── */

/** Minimal escaping for text about to become markup. */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The same, for a value sitting in the XML outside the CDATA. */
export const escapeXml = escapeHtml;

/**
 * Wrap a block of HTML in CDATA, safely.
 *
 * A CDATA section ends at the first `]]>`, so one appearing in an event's own
 * description would close the section early and spill raw markup into the
 * feed — a broken document for every subscriber, caused by one member's
 * punctuation. Split across two sections, which is the standard way out and
 * concatenates back to the same text.
 */
export function cdata(html: string): string {
  return `<![CDATA[${String(html ?? '').split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

/* ───────────────────────── text ───────────────────────── */

/** "$19.50", and the right symbol for a co-op not billing in dollars. */
export function money(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(cents / 100);
  } catch {
    return '$' + (cents / 100).toFixed(2);
  }
}

const AGE_LABELS: Record<string, string> = {
  AGES_13_PLUS: '13+',
  AGES_18_PLUS: '18+',
  AGES_21_PLUS: '21+',
};

/** The age limit, or nothing when it is for everybody. */
export function ageBadge(level?: string | null): string | null {
  return (level && AGE_LABELS[level]) || null;
}

/*
  No countdown here, by instruction and for a reason that fits it.

  The website embed shows "Starts in 36 minutes", which it can keep true
  because it re-renders every time somebody loads the page. An email is built
  once and read whenever it is opened, so a countdown in one is a number that
  was right at send and wrong by morning. The date is already on every row
  and does not go stale.
*/

/** Trim to a readable excerpt on a word, not mid-syllable. */
export function clamp(text: string | null | undefined, max: number): string {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* ───────────────────────── when ───────────────────────── */

/**
 * "Sun, Nov 1 · 5:30pm to 7:30pm", in the co-op's own timezone.
 *
 * The website embed formats in the *reader's* timezone, because a browser
 * knows what that is. An email does not — it is rendered once, on a server,
 * for everybody — so this renders in the co-op's timezone, which is where
 * the event physically is. A member three timezones away reading "7:30pm"
 * about a room in Louisville wants Louisville's 7:30.
 *
 * Same shape as the website embed otherwise (EVT-54): lowercase closed-up
 * meridiem, "to" between the ends, and the date repeated when an event runs
 * past midnight.
 */
export function when(start: string | Date, end: string | Date | null | undefined, timeZone: string): string {
  const d = new Date(start);
  if (isNaN(d.getTime())) return '';

  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone,
    }).format(value);

  const clock = (value: Date) =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
      .format(value)
      .replace(/[\s  ]*([AaPp])\.?[Mm]\.?$/, (_m, half: string) => half.toLowerCase() + 'm');

  const from = `${day(d)} · ${clock(d)}`;
  if (!end) return from;

  const e = new Date(end);
  if (isNaN(e.getTime()) || e.getTime() <= d.getTime()) return from;

  return `${from} to ${day(e) === day(d) ? clock(e) : `${day(e)} · ${clock(e)}`}`;
}

/** RFC 822, which is what `<pubDate>` is defined in terms of. */
export function rfc822(date: Date): string {
  return date.toUTCString().replace('GMT', '+0000');
}

/* ───────────────────────── the blocks ───────────────────────── */

export type EmbedEvent = {
  title: string;
  slug?: string;
  description?: string | null;
  startTime: string | Date;
  endTime?: string | Date | null;
  location?: string | null;
  totalCents?: number | null;
  currency?: string | null;
  imageUrl?: string | null;
  maturityLevel?: string | null;
  url: string;
};

type Theme = { accent: string; text: string; label: string; timeZone: string };

/*
  The web-safe stack, single-quoted inside a double-quoted attribute.

  A literal `"Segoe UI"` closes `style="` at its first quote and spills the
  rest of the declaration into the tag. Writing the quotes as `&quot;` fixed
  the parse but not the rendering: a viewer that re-serialises the attribute
  without decoding leaves `&quot;Segoe UI&quot;` as the CSS value, which is
  not a valid font name — and the whole rule went with it, which is how the
  first preview came back in Times with blue underlined links.

  Single quotes need no decoding by anybody. Same CSS, one less thing
  between here and a mail client.
*/
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const BORDER = '#dcdcdc';
const INK = '#1a1a1a';
const MUTED = '#555555';

/**
 * The picture, when there is one.
 *
 * Returns null rather than a placeholder, because the website embed draws no
 * thumbnail cell at all for an event without a poster — the title starts at
 * the card's edge. Filling that space with a coloured square, which is what
 * this did first, put a block of brand colour beside every untitled row and
 * made the list read as a column of swatches.
 *
 * `width` and `height` are attributes as well as styles: Outlook ignores the
 * styles.
 */
function thumb(event: EmbedEvent, size: number): string | null {
  if (!event.imageUrl) return null;
  return `<img src="${escapeHtml(event.imageUrl)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;border-radius:8px;" />`;
}

/**
 * The hero's picture, or a block of the co-op's colour.
 *
 * Here the fallback stays, because the hero is a poster-shaped space and an
 * empty one reads as a broken image rather than as a choice. The raw accent,
 * not the darkened text colour — MaybeItsFate's `#afd2e9` is a pale blue and
 * that is what the website embed fills this with.
 */
function heroPicture(event: EmbedEvent, theme: Theme): string {
  if (event.imageUrl) {
    return `<img src="${escapeHtml(event.imageUrl)}" width="560" height="220" alt="" style="display:block;width:100%;max-width:560px;height:220px;border:0;outline:none;text-decoration:none;border-radius:10px;" />`;
  }
  return [
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;width:100%;">',
    `<tr><td bgcolor="${theme.accent}" height="220" style="background-color:${theme.accent};height:220px;border-radius:10px;font-size:0;line-height:0;">&nbsp;</td></tr>`,
    '</table>',
  ].join('');
}

/**
 * The facts under a title, in the weights the website embed gives them.
 *
 * Three different things, so three different treatments rather than one
 * accent-coloured string joined with separators: the date is the accent and
 * bold because it is what somebody is scanning for, the room is quiet grey
 * because it is context, and the age limit is dark and bold because it is a
 * condition of coming.
 */
function facts(event: EmbedEvent, theme: Theme): string {
  const parts = [
    `<span style="color:${theme.text};font-weight:700;">${escapeHtml(when(event.startTime, event.endTime, theme.timeZone))}</span>`,
  ];
  if (event.location) {
    parts.push(`<span style="color:#6b6b6b;">${escapeHtml(event.location)}</span>`);
  }
  const age = ageBadge(event.maturityLevel);
  if (age) {
    parts.push(`<span style="color:${INK};font-weight:700;">${escapeHtml(age)}</span>`);
  }
  // Non-breaking spaces rather than a margin: there is no reliable spacing
  // between inline elements in Outlook.
  return parts.join('&nbsp;&nbsp;&nbsp;');
}

/** One chip of meta — a room name, an age limit. */
function chip(text: string): string {
  return [
    '<td style="padding:0 8px 0 0;" valign="top">',
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr>',
    `<td bgcolor="#f1f0ee" style="background-color:#f1f0ee;border-radius:999px;padding:7px 14px;mso-padding-alt:7px 14px;font-family:${FONT};font-size:13px;color:#444444;white-space:nowrap;">${escapeHtml(text)}</td>`,
    '</tr></table>',
    '</td>',
  ].join('');
}

/**
 * The thing to press.
 *
 * A bare `<a>` with padding collapses in Outlook, which lays out through
 * Word and ignores padding on an inline element — so the button is a
 * one-cell table and the padding is the cell's. Filled for buying, outlined
 * for everything else, which is the website embed's two weights.
 *
 * The wording is a promise about what happens next and is ported exactly:
 * the figure is `totalCents`, the total Stripe will ring up, never the face
 * value. Advertising a face value in an email is the same mistake as
 * advertising it on a website, posted to more people.
 */
function button(event: EmbedEvent, theme: Theme, align: 'left' | 'right'): string {
  const ticketed = typeof event.totalCents === 'number';
  const label = ticketed
    ? `Buy ticket · ${money(event.totalCents as number, event.currency ?? 'usd')}`
    : 'RSVP';

  const fill = ticketed ? theme.text : '#ffffff';
  const ink = ticketed ? onAccent(theme.text) : theme.text;
  const edge = ticketed ? theme.text : BORDER;

  return [
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align}" style="border-collapse:separate;">`,
    '<tr>',
    `<td align="center" bgcolor="${fill}" style="background-color:${fill};border:1px solid ${edge};border-radius:10px;padding:11px 20px;mso-padding-alt:11px 20px;">`,
    `<a href="${escapeHtml(event.url)}" target="_blank" style="font-family:${FONT};font-size:14px;font-weight:700;color:${ink};text-decoration:none;display:inline-block;white-space:nowrap;">${escapeHtml(label)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
  ].join('');
}

/**
 * The next event, given the room it deserves — the website embed's hero.
 *
 * Carries no faces and no "2 going", the same line the website embed holds:
 * an event link may be public so strangers can come, the guest list is not.
 * In an email that matters more, because an email gets forwarded.
 */
export function heroBlock(event: EmbedEvent, theme: Theme): string {
  const chips = [event.location, ageBadge(event.maturityLevel)].filter(Boolean) as string[];

  return [
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="border-collapse:separate;width:100%;background-color:#ffffff;border:1px solid ${BORDER};border-radius:12px;margin:0 0 16px 0;">`,
    '<tr><td style="padding:22px;">',

    `<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};padding:0 0 14px 0;">Next Event</div>`,

    `<div style="padding:0 0 16px 0;">${heroPicture(event, theme)}</div>`,

    `<div style="font-family:${FONT};font-size:24px;font-weight:700;line-height:1.25;color:${INK};padding:0 0 8px 0;">`,
    `<a href="${escapeHtml(event.url)}" target="_blank" style="color:${INK};text-decoration:none;">${escapeHtml(event.title)}</a>`,
    '</div>',

    `<div style="font-family:${FONT};font-size:15px;font-weight:700;color:${theme.text};padding:0 0 12px 0;">${escapeHtml(when(event.startTime, event.endTime, theme.timeZone))}</div>`,

    event.description
      ? `<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#444444;padding:0 0 16px 0;">${escapeHtml(clamp(event.description, 220))}</div>`
      : '',

    chips.length
      ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px 0;"><tr>${chips.map(chip).join('')}</tr></table>`
      : '',

    button(event, theme, 'left'),

    '</td></tr>',
    '</table>',
  ].join('');
}

/**
 * Every other event, as a row.
 *
 * Three cells, or two where there is no poster — the thumbnail cell is not
 * drawn at all rather than filled, which is what the website embed does and
 * what keeps a list of mostly-imageless events from reading as a column of
 * coloured squares.
 *
 * They stay side by side at phone width rather than stacking: the website
 * embed stacks them with a media query, and a media query is the first thing
 * Gmail removes. A 72px thumbnail and a short button fit at 320px without
 * one.
 */
export function rowBlock(event: EmbedEvent, theme: Theme): string {
  const picture = thumb(event, 72);

  return [
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="border-collapse:separate;width:100%;background-color:#ffffff;border:1px solid ${BORDER};border-radius:12px;margin:0 0 12px 0;">`,
    '<tr>',

    picture
      ? `<td width="86" valign="middle" style="padding:16px 0 16px 16px;width:86px;">${picture}</td>`
      : '',

    `<td valign="middle" style="padding:16px ${picture ? '14px' : '16px'};">`,
    `<div style="font-family:${FONT};font-size:16px;font-weight:700;line-height:1.3;color:${INK};padding:0 0 4px 0;">`,
    `<a href="${escapeHtml(event.url)}" target="_blank" style="color:${INK};text-decoration:none;">${escapeHtml(event.title)}</a>`,
    '</div>',
    `<div style="font-family:${FONT};font-size:14px;line-height:1.4;">${facts(event, theme)}</div>`,
    '</td>',

    `<td align="right" valign="middle" style="padding:16px 16px 16px 0;">${button(event, theme, 'right')}</td>`,

    '</tr>',
    '</table>',
  ].join('');
}

/* ───────────────────────── the document ───────────────────────── */

export type EmailFeedInput = {
  org: { name: string; slug: string; brandColor?: string | null; timezone?: string | null };
  /** Inside the 30-day window, newest first — the same list the website embed draws. */
  events: EmbedEvent[];
  /** The next 15 beyond it, which "See More" reveals on the website (EVT-54). */
  more: EmbedEvent[];
  siteUrl: string;
  now: Date;
};

/**
 * The block a campaign drops in.
 *
 * `events` and `more` arrive separately because the website embed renders
 * them differently — one list, and a button for the rest. An email has no
 * button that can reveal anything, so both are laid out, with a rule between
 * them saying where the fortnight ends. Hiding the second group would mean a
 * campaign quietly advertising less than the website does; running them
 * together unlabelled would mean "upcoming" silently meaning three months.
 */
export function eventsHtml(input: EmailFeedInput): string {
  const theme: Theme = {
    accent: input.org.brandColor || DEFAULT_ACCENT,
    text: accentText(input.org.brandColor || DEFAULT_ACCENT),
    label: input.org.name,
    timeZone: input.org.timezone || 'America/New_York',
  };

  const all = [...input.events, ...input.more];
  if (!all.length) {
    return [
      `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;width:100%;">`,
      `<tr><td style="font-family:${FONT};font-size:14px;color:${MUTED};padding:24px 0;">No events in the next 30 days.</td></tr>`,
      '</table>',
    ].join('');
  }

  const [first, ...rest] = all;
  const afterWindow = Math.max(input.events.length - 1, 0);

  const blocks = rest.map((event, index) => {
    // One rule where the advertised window ends, so "Later on" is a fact
    // about the calendar rather than a guess about how far down you are.
    const divider =
      index === afterWindow && input.more.length
        ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;"><tr><td style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};padding:10px 0 12px 0;border-top:1px solid ${BORDER};">Later on</td></tr></table>`
        : '';
    return divider + rowBlock(event, theme);
  });

  return [
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;max-width:600px;margin:0 auto;">`,
    '<tr><td style="padding:0;">',
    heroBlock(first, theme),
    ...blocks,
    '</td></tr>',
    '</table>',
  ].join('');
}

/**
 * The whole feed.
 *
 * One `<item>`, not one per event, and that is the point of the thing: a
 * campaign tool drops an item's `<description>` into a template, so one item
 * carrying the whole laid-out block gives a co-op the list they wanted. One
 * item per event would hand them a loop to configure and a layout to rebuild
 * in somebody else's editor.
 *
 * `<guid>` is stable for the same reason — `<slug>-events-feed` every time,
 * never a date — so a campaign tool treats each fetch as the same block
 * updated rather than as a new post to send on its own.
 */
export function rssFeed(input: EmailFeedInput): string {
  const site = input.siteUrl.replace(/\/+$/, '');
  const orgUrl = `${site}/orgs/${input.org.slug}/events`;

  return [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<rss version="2.0">',
    '<channel>',
    `  <title>${escapeXml(input.org.name)} — Upcoming Events</title>`,
    `  <link>${escapeXml(orgUrl)}</link>`,
    '  <description>Automated email campaign feed</description>',
    `  <lastBuildDate>${rfc822(input.now)}</lastBuildDate>`,
    '  <item>',
    '    <title>Latest Events Feed Block</title>',
    `    <link>${escapeXml(orgUrl)}</link>`,
    `    <pubDate>${rfc822(input.now)}</pubDate>`,
    `    <guid isPermaLink="false">${escapeXml(input.org.slug)}-events-feed</guid>`,
    `    <description>${cdata(eventsHtml(input))}</description>`,
    '  </item>',
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}
