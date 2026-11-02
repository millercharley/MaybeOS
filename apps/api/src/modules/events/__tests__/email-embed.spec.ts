import {
  accentText,
  ageBadge,
  cdata,
  clamp,
  escapeHtml,
  eventsHtml,
  heroBlock,
  money,
  onAccent,
  rfc822,
  rowBlock,
  rssFeed,
  when,
  DEFAULT_ACCENT,
  type EmbedEvent,
} from '../email-embed';

/**
 * The events embed, for an email campaign (EVT-55).
 *
 * Charley pasted the website embed into MailerLite and got nothing, which is
 * what a `<script>` tag does in an email. The website embed is not at fault
 * and is untouched; this is a second way out of the same data for the one
 * medium that cannot run code.
 *
 * Two things have to hold, and neither is visible by reading the output
 * casually:
 *
 *   1. it is email-safe — tables, inline styles, nothing a client strips;
 *   2. it is a valid XML document whatever a member typed into an event.
 *
 * The second is the one that bites. A feed is parsed by somebody else's
 * software, so a single stray `]]>` or `&` in a co-op's own copy is not a
 * cosmetic bug — it is a campaign that will not send.
 */
const NOW = new Date('2026-11-02T13:00:00.000Z');

/** The same digest the feed takes, for the one test that needs to predict it. */
const createHashOf = (text: string) =>
  require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);

const EVENT: EmbedEvent = {
  title: 'Figure drawing',
  slug: 'figure-drawing',
  description: 'Bring your own materials. Model provided.',
  startTime: '2026-11-01T23:30:00.000Z',
  endTime: '2026-11-02T02:30:00.000Z',
  location: 'Attic',
  totalCents: null,
  currency: 'usd',
  imageUrl: null,
  maturityLevel: 'AGES_21_PLUS',
  url: 'https://maybeos.org/portal/maybeitsfate/events/figure-drawing',
};

const TICKETED: EmbedEvent = {
  ...EVENT,
  title: "The Guy Who Didn't Like Musicals",
  slug: 'musicals',
  totalCents: 1675,
  maturityLevel: 'AGES_13_PLUS',
  imageUrl: 'https://example.com/poster.jpg',
  url: 'https://maybeos.org/portal/maybeitsfate/events/musicals',
};

const ORG = {
  name: 'MaybeItsFate',
  slug: 'maybeitsfate',
  brandColor: '#afd2e9',
  timezone: 'America/New_York',
};

const feed = (events: EmbedEvent[], more: EmbedEvent[] = []) =>
  rssFeed({ org: ORG, events, more, siteUrl: 'https://maybeos.org', now: NOW });

const block = (events: EmbedEvent[], more: EmbedEvent[] = []) =>
  eventsHtml({ org: ORG, events, more, siteUrl: 'https://maybeos.org', now: NOW });

describe('the document', () => {
  it('is a valid RSS 2.0 envelope', () => {
    const xml = feed([EVENT]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" ?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<description>Automated email campaign feed</description>');
  });

  it('carries the whole block in one item, not one item per event', () => {
    /*
      The point of the thing. A campaign tool drops an item's description
      into a template, so one item carrying the laid-out list gives a co-op
      what they asked for; one item per event would hand them a loop to
      configure and a layout to rebuild in somebody else's editor.
    */
    const xml = feed([EVENT, TICKETED, { ...EVENT, slug: 'third' }]);
    expect(xml.match(/<item>/g) ?? []).toHaveLength(1);
    expect(xml).toContain('<title>Latest Events Feed Block</title>');
  });

  /*
    The guid tracks the content (EVT-58).

    It was fixed — `<slug>-events-feed` — on the reasoning that each fetch is
    the same block updated rather than a new post. That was wrong about what
    a guid means to the reader: it is how a consumer recognises an item it
    already holds, so one that never changes says "you have seen this".
    MailerLite went on rendering the copy it stored the first time, and two
    deploys of layout fixes reached the campaign as the original markup.
  */
  const guidOf = (xml: string) => /<guid[^>]*>([^<]+)<\/guid>/.exec(xml)?.[1];

  it('is marked as an identifier rather than a URL', () => {
    expect(feed([EVENT])).toContain('isPermaLink="false"');
    expect(guidOf(feed([EVENT]))).toMatch(/^maybeitsfate-events-[0-9a-f]{16}$/);
  });

  it('does not change while the block does not', () => {
    // Otherwise every poll looks like a new item, which is what makes an RSS
    // campaign send the same events twice.
    expect(guidOf(feed([EVENT]))).toBe(guidOf(feed([EVENT])));
  });

  it('changes when an event is added', () => {
    expect(guidOf(feed([EVENT]))).not.toBe(guidOf(feed([EVENT, TICKETED])));
  });

  it('changes when an event is edited', () => {
    const moved = { ...EVENT, startTime: '2026-11-02T23:30:00.000Z' };
    expect(guidOf(feed([EVENT]))).not.toBe(guidOf(feed([moved])));
  });

  it('changes when the layout changes but the events do not', () => {
    /*
      The case that caused this. Both deploys altered only the markup, and a
      fixed guid meant the campaign never re-read it.
    */
    const asBefore = guidOf(feed([EVENT]));
    const withDifferentMarkup = createHashOf(
      eventsHtml({
        org: ORG,
        events: [EVENT],
        more: [],
        siteUrl: 'https://maybeos.org',
        now: NOW,
      }).replace('cellpadding="20"', 'cellpadding="0"'),
    );
    expect(asBefore).not.toContain(withDifferentMarkup);
  });

  it('identifies the block it actually shipped', () => {
    /*
      The invariant behind all of the above: the guid is the digest of the
      description in the same document, not of a second render that happens
      to agree today. Asserting only that they are each correct let a version
      through that rendered the block twice — harmless while the render is
      deterministic, and a silent mismatch the moment it is not.
    */
    const xml = feed([EVENT, TICKETED], [{ ...EVENT, slug: 'later' }]);
    const body = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(xml)?.[1];
    expect(body).toBeTruthy();
    expect(guidOf(xml)).toBe(`maybeitsfate-events-${createHashOf(body as string)}`);
  });

  it('does not move merely because time passed', () => {
    // A timestamp would be the other extreme, and the reason the fixed guid
    // looked right in the first place.
    const later = rssFeed({
      org: ORG,
      events: [EVENT],
      more: [],
      siteUrl: 'https://maybeos.org',
      now: new Date(NOW.getTime() + 86_400_000),
    });
    expect(guidOf(feed([EVENT]))).toBe(guidOf(later));
  });

  it('dates the feed in RFC 822, which is what pubDate means', () => {
    expect(rfc822(NOW)).toBe('Mon, 02 Nov 2026 13:00:00 +0000');
    expect(feed([EVENT])).toContain('<pubDate>Mon, 02 Nov 2026 13:00:00 +0000</pubDate>');
  });

  it('wraps the markup in CDATA', () => {
    expect(feed([EVENT])).toContain('<![CDATA[');
  });
});

describe('a feed stays parseable whatever a member typed', () => {
  it('splits a CDATA terminator rather than ending the section', () => {
    /*
      The failure that takes the whole campaign down. `]]>` inside an event's
      own description would close the section early and spill raw markup into
      the document.
    */
    const out = cdata('before ]]> after');
    expect(out).toBe('<![CDATA[before ]]]]><![CDATA[> after]]>');
    /*
      And a parser reading it back gets the original text, `]]>` included —
      the two sections concatenate, they do not drop anything. Splitting a
      terminator that silently ate it would be a quieter bug than the one
      this fixes.
    */
    expect(out.split('<![CDATA[').join('').split(']]>').join('')).toBe('before ]]> after');
  });

  it('survives an event whose description contains one', () => {
    const xml = feed([{ ...EVENT, description: 'Tricky ]]> copy' }]);
    expect(() => require('fast-xml-parser')).toBeDefined();
    // Nothing after the first section may be outside a CDATA or a tag.
    expect(xml).not.toMatch(/\]\]>[^<]*[a-z]+ copy/);
  });

  it('escapes the channel title rather than trusting it', () => {
    const xml = rssFeed({
      org: { ...ORG, name: 'Fish & Chips <Co-op>' },
      events: [EVENT],
      more: [],
      siteUrl: 'https://maybeos.org',
      now: NOW,
    });
    expect(xml).toContain('Fish &amp; Chips &lt;Co-op&gt;');
    expect(xml).not.toContain('<Co-op>');
  });

  it('escapes an event title inside the markup', () => {
    const html = block([{ ...EVENT, title: 'Tom & Jerry <b>live</b>' }]);
    expect(html).toContain('Tom &amp; Jerry &lt;b&gt;live&lt;/b&gt;');
  });

  it('escapes a url before putting it in an attribute', () => {
    const html = block([{ ...EVENT, url: 'https://x.test/a"onmouseover="alert(1)' }]);
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('escapes the five that matter', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('the markup is email-safe', () => {
  const html = block([EVENT, TICKETED]);

  it('uses no layout an email client throws away', () => {
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('@media');
  });

  it('carries no classes, because there is no stylesheet to match them', () => {
    expect(html).not.toMatch(/class="/);
    expect(html).not.toContain('<style');
  });

  it('builds the layout from tables', () => {
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('cellpadding="0"');
    expect(html).toContain('cellspacing="0"');
  });

  it('names web-safe fonts explicitly on the text', () => {
    // There is no inherited body font in an email.
    expect(html).toContain(
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    );
  });

  it('does not break the attribute it sits in', () => {
    /*
      The bug this caught. A literal `"Segoe UI"` inside `style="..."` closes
      the attribute at its first quote, and the rest of the declaration
      becomes stray text in the tag — in every element, since every element
      here is inline-styled. The entity parses back to the same CSS.
    */
    expect(html).not.toContain('"Segoe UI"');
    /*
      Nor the entity form. It parsed correctly and still rendered wrong: a
      viewer that re-serialises the attribute without decoding leaves
      `&quot;Segoe UI&quot;` as the CSS value, which is not a font name, and
      the rule goes with it. The first preview came back in Times.
    */
    expect(html).not.toContain('&quot;Segoe UI&quot;');
    for (const attr of html.match(/style="[^"]*"/g) ?? []) {
      expect(attr).not.toContain('font-family:-apple-system, BlinkMacSystemFont, ;');
      expect(attr.endsWith('"')).toBe(true);
    }
    // Every opening tag closes before the next one opens.
    expect(html).not.toMatch(/<[a-z]+[^>]*<[a-z]/i);
  });

  it('gives each card a solid white fill and a soft border', () => {
    // `bgcolor` as well as the style, because Outlook ignores the style.
    expect(html).toContain('bgcolor="#ffffff"');
    expect(html).toContain('border:1px solid #dcdcdc');
    expect(html).toContain('border-radius:12px');
  });

  it('wraps every button in a table so Outlook cannot clip it', () => {
    /*
      Outlook lays out through Word, which ignores padding on an inline
      element — a bare padded `<a>` loses its shape entirely. So the padding
      belongs to a cell, and the `<a>` has to actually be inside one.

      Checking that `mso-padding-alt` appears somewhere was not enough: it
      survived gutting the table that carries it.
    */
    const row = rowBlock(TICKETED, THEME);

    /*
      The button's own table, not the row cell that happens to be aligned
      right as well — which is what the first attempt at this matched.

      The padding moved from the cell's style to the table's `cellpadding`
      (EVT-57), so it survives a sanitiser; `mso-padding-alt` went with it,
      having been the Outlook half of a style that is no longer there.
    */
    expect(row).toMatch(
      /<table role="presentation" border="0" cellpadding="11" cellspacing="0" align="right"[^>]*><tr><td align="center" bgcolor="[^"]*"[^>]*><a href=/,
    );
    // And the hero's, which is the other weight.
    expect(heroBlock(EVENT, THEME)).toMatch(
      /<table[^>]*align="left"[^>]*><tr><td align="center"[^>]*><a href=/,
    );
  });
});

/**
 * It still stands up with every style removed (EVT-57).
 *
 * MailerLite's RSS block sanitises the markup before it renders it: of the
 * 268 `style` attributes this block carries, its output kept none, while
 * `align`, `valign`, `border`, `cellpadding`, `cellspacing`, `width`,
 * `height` and `bgcolor` all came through untouched. The campaign showed
 * unstyled text at the wrong width — not because the markup was wrong, but
 * because the one mechanism email normally leaves you had been taken away.
 *
 * Their block has its own Title / Meta / Text / Link controls, so this is
 * deliberate: it is built to pour a feed into the campaign's own typography.
 * Fighting it is the wrong move; surviving it is not.
 *
 * So everything structural is said twice, and these run against a copy with
 * the styles removed — which is the version a campaign actually renders.
 */
describe('with every style stripped, as MailerLite does', () => {
  const bare = (html: string) => html.replace(/\sstyle="[^"]*"/g, '');
  const stripped = bare(block([EVENT, TICKETED], [{ ...EVENT, slug: 'later' }]));

  it('really has no styles left to lean on', () => {
    expect(stripped).not.toContain('style=');
  });

  it('fills the column it is dropped into', () => {
    // `max-width:600px; margin:0 auto` was a style, so the block spilled to
    // whatever width the RSS block gave it.
    expect(stripped).toMatch(/^<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">/);
    expect(stripped).not.toContain('max-width');
  });

  it('keeps the cards apart', () => {
    /*
      The gap between cards was a bottom margin, so they sat flush and the
      list read as one grey slab.

      Checking that a `height="12"` row exists anywhere was not enough — the
      hero's own internal spacers are the same height, so the assertion
      passed with every gap between cards removed.
    */
    expect(stripped).toMatch(
      /<\/table><\/td><\/tr><tr><td height="\d+">&nbsp;<\/td><\/tr><tr><td><table/,
    );
    // One spacer for each card after the hero.
    const cards = stripped.match(/<table [^>]*bgcolor="#ffffff"/g) ?? [];
    const spacers = stripped.match(/<tr><td height="12">/g) ?? [];
    expect(spacers.length).toBeGreaterThanOrEqual(cards.length - 1);
  });

  it('keeps room inside every card', () => {
    // Padding was on the cells, in a style. `cellpadding` is an attribute.
    expect(stripped).toContain('cellpadding="20"');
    expect(stripped).toContain('cellpadding="14"');
    expect(stripped).toContain('cellpadding="11"');
  });

  it('does not pad twice where cellpadding carries it', () => {
    /*
      The trap in saying it both ways: a client that reads the attribute and
      the style adds them. So a cell with `cellpadding` has no padding left
      in its own style.
    */
    const full = block([EVENT, TICKETED]);
    for (const table of full.split('<table').slice(1)) {
      const open = table.slice(0, table.indexOf('>'));
      const padded = /cellpadding="([1-9]\d*)"/.exec(open);
      if (!padded) continue;
      const firstCell = table.slice(table.indexOf('<td'), table.indexOf('</td>'));
      expect(firstCell).not.toMatch(/[^-]padding:/);
    }
  });

  it('keeps the white cards and the coloured fills', () => {
    expect(stripped).toContain('bgcolor="#ffffff"');
    expect(stripped).toContain(`bgcolor="${THEME.accent}"`);
  });

  it('keeps the titles and dates emphasised', () => {
    /*
      `font-weight` was a style; `<b>` is not.

      Anchored at the hero and at a row separately: matching the title
      anywhere passed while the hero's own `<b>` was gone, because another
      event further down still had one.
    */
    const hero = bare(heroBlock(EVENT, THEME));
    expect(hero).toMatch(/<a href[^>]*><b>Figure drawing<\/b><\/a>/);
    const row = bare(rowBlock(TICKETED, THEME));
    expect(row).toMatch(/<a href[^>]*><b>The Guy Who Didn&#39;t Like Musicals<\/b><\/a>/);
    expect(stripped).toMatch(/<b>Sun, Nov 1 · 6:30pm to 9:30pm<\/b>/);
    expect(stripped).toContain('<b>NEXT EVENT</b>');
    expect(stripped).toContain('<b>LATER ON</b>');
  });

  it('keeps the thumbnail sized', () => {
    expect(stripped).toContain('width="72" height="72"');
  });

  it('keeps the hero’s colour block standing', () => {
    // Its height was in a style as well as an attribute.
    expect(stripped).toMatch(/<td bgcolor="#afd2e9" height="220">/);
  });

  it('keeps the buttons legible without a text colour', () => {
    /*
      The website embed fills its buy button with the darkened accent and
      writes on it in white, which works only while the text colour is ours
      to set. Stripped, the label falls back to whatever colour the campaign
      gives links — and white-on-slate becomes unreadable-on-slate. A pale
      fill is legible under either rule.
    */
    const buy = bare(rowBlock(TICKETED, THEME));
    expect(buy).toContain(`bgcolor="${THEME.accent}"`);
    expect(buy).not.toContain(`bgcolor="${THEME.text}"`);
    expect(buy).toContain('<b>Buy ticket · $16.75</b>');
  });

  it('still separates the three facts without colour', () => {
    expect(stripped).toMatch(
      /<b>Sun, Nov 1[^<]*<\/b>&nbsp;&nbsp;&nbsp;<span>Attic<\/span>&nbsp;&nbsp;&nbsp;<b>13\+<\/b>/,
    );
  });
});

describe('what the blocks say', () => {
  it('leads with a hero labelled Next Event', () => {
    const html = block([EVENT, TICKETED]);
    // Upper-cased in the markup rather than by `text-transform`, which is a
    // style and therefore not guaranteed to arrive (EVT-57).
    expect(html).toContain('NEXT EVENT');
    expect(html.indexOf('NEXT EVENT')).toBeLessThan(html.indexOf(escapeHtml(TICKETED.title)));
  });

  it('draws only one hero, however many events there are', () => {
    const html = block([EVENT, TICKETED, { ...EVENT, slug: 'c' }]);
    expect(html.match(/NEXT EVENT/g) ?? []).toHaveLength(1);
  });

  it('does not also draw the first event as a row', () => {
    /*
      Counting the "Next Event" label missed this: the label comes from the
      hero, so printing the first event a second time underneath left the
      count at one and the list with a duplicate.

      Each block links its event twice — once from the title, once from the
      button — so the first event's address appearing four times means it
      was drawn twice.
    */
    const html = block([EVENT, TICKETED]);
    expect(html.split(EVENT.url).length - 1).toBe(2);
    expect(html.split(TICKETED.url).length - 1).toBe(2);
  });

  it('says RSVP for a free event', () => {
    expect(rowBlock(EVENT, THEME)).toContain('>RSVP<');
  });

  it('quotes the total, fees and all, for a ticketed one', () => {
    // The figure Stripe will ring up. Advertising the face value in an email
    // is the website's mistake, posted to more people.
    expect(rowBlock(TICKETED, THEME)).toContain('Buy ticket · $16.75');
  });

  it('formats a currency that is not dollars', () => {
    expect(money(1675, 'gbp')).toContain('16.75');
    expect(money(1675, 'gbp')).not.toBe('$16.75');
  });

  it('fills the hero with the co-op’s colour when there is no poster', () => {
    // The hero is a poster-shaped space; an empty one reads as a broken
    // image. The raw accent, not the darkened text colour.
    const html = heroBlock(EVENT, THEME);
    expect(html).not.toContain('<img');
    expect(html).toContain(`bgcolor="${THEME.accent}"`);
  });

  it('draws no thumbnail cell at all on a row with no poster', () => {
    /*
      What the first version got wrong. It filled the space with a square of
      brand colour, so a list of mostly-imageless events read as a column of
      swatches. The website embed draws nothing and lets the title start at
      the card's edge.
    */
    const bare = rowBlock(EVENT, THEME);
    expect(bare).not.toContain('<img');
    expect(bare).not.toContain(`bgcolor="${THEME.accent}"`);
    // The thumbnail cell is the one with a fixed width; counting every `<td`
    // would count the button's own cell too.
    expect(bare).not.toContain('<td width="72"');

    // And it is there when there is something to put in it.
    expect(rowBlock(TICKETED, THEME)).toContain('<td width="72"');
  });

  it('gives the date, the room and the age limit different weights', () => {
    // Three different things: what you are scanning for, context, and a
    // condition of coming. One accent-coloured joined string said they were
    // the same thing.
    const row = rowBlock(TICKETED, THEME);
    expect(row).toContain(`<b style="color:${THEME.text};font-weight:700;">Sun, Nov`);
    expect(row).toContain('<span style="color:#6b6b6b;">Attic</span>');
    expect(row).toContain(`<b style="color:#1a1a1a;font-weight:700;">13+</b>`);
  });

  it('uses the poster when there is one, with width as an attribute', () => {
    const html = rowBlock(TICKETED, THEME);
    expect(html).toContain('<img src="https://example.com/poster.jpg"');
    expect(html).toContain('width="72"');
  });

  it('shows the age limit where there is one, and nothing where there is not', () => {
    expect(ageBadge('AGES_21_PLUS')).toBe('21+');
    expect(ageBadge('ALL_AGES')).toBeNull();
    expect(ageBadge(null)).toBeNull();
    expect(ageBadge(undefined)).toBeNull();
  });

  it('carries no faces and no attendance', () => {
    /*
      The same line the website embed holds, and it matters more here: an
      email gets forwarded. An event link may be public so strangers can
      come; who is attending is not.
    */
    const html = block([EVENT, TICKETED]);
    expect(html).not.toMatch(/going|rsvpFaces|attending|avatar/i);
  });
});

describe('the window and what lies past it', () => {
  it('lays out both lists, because an email has no button to reveal one', () => {
    const html = block([EVENT], [TICKETED]);
    expect(html).toContain(EVENT.title);
    // Escaped on the way in — the apostrophe in this title is why.
    expect(html).toContain(escapeHtml(TICKETED.title));
    expect(html).not.toContain('See More');
  });

  it('marks where the advertised window ends', () => {
    // Running them together unlabelled would make "upcoming" quietly mean
    // three months.
    expect(block([EVENT], [TICKETED])).toContain('LATER ON');
  });

  it('draws no divider when there is nothing past the window', () => {
    expect(block([EVENT, TICKETED], [])).not.toContain('LATER ON');
  });

  it('says so plainly when there is nothing at all', () => {
    expect(block([], [])).toContain('No events in the next 30 days.');
  });
});

describe('times are the co-op’s, not the server’s', () => {
  it('renders in the co-op’s timezone', () => {
    /*
      The website embed formats in the reader's timezone because a browser
      knows what that is. An email is rendered once, on a server, for
      everybody — so this uses the co-op's, which is where the room is. A
      member three timezones away reading "7:30pm" about a room in
      Louisville wants Louisville's 7:30.
    */
    expect(when('2026-11-01T23:30:00.000Z', '2026-11-02T02:30:00.000Z', 'America/New_York')).toBe(
      'Sun, Nov 1 · 6:30pm to 9:30pm',
    );
    expect(when('2026-11-01T23:30:00.000Z', '2026-11-02T02:30:00.000Z', 'America/Los_Angeles')).toBe(
      'Sun, Nov 1 · 3:30pm to 6:30pm',
    );
  });

  it('applies the timezone to the date, not only the clock', () => {
    // An instant that falls on different days either side of the country.
    // Formatting the clock in the co-op's zone and the date in the server's
    // would pass the case above and print the wrong day here.
    expect(when('2026-11-02T06:00:00.000Z', null, 'America/New_York')).toBe('Mon, Nov 2 · 1:00am');
    expect(when('2026-11-02T06:00:00.000Z', null, 'America/Los_Angeles')).toBe(
      'Sun, Nov 1 · 10:00pm',
    );
  });

  it('keeps the website embed’s format', () => {
    const out = when('2026-11-01T23:30:00.000Z', null, 'America/New_York');
    expect(out).toBe('Sun, Nov 1 · 6:30pm');
    expect(out).not.toMatch(/\s(PM|AM)/);
  });

  it('repeats the date when an event runs past midnight', () => {
    expect(when('2026-11-21T03:00:00.000Z', '2026-11-21T06:00:00.000Z', 'America/New_York')).toBe(
      'Fri, Nov 20 · 10:00pm to Sat, Nov 21 · 1:00am',
    );
  });

  it('ignores an end that is missing, equal or backwards', () => {
    const start = '2026-11-01T23:30:00.000Z';
    for (const end of [null, undefined, start, '2026-11-01T20:00:00.000Z', 'rubbish']) {
      expect(when(start, end as never, 'America/New_York')).toBe('Sun, Nov 1 · 6:30pm');
    }
  });
});

describe('there is no countdown', () => {
  /*
    Removed on instruction, and the reason fits an email. The website embed
    says "Starts in 36 minutes" and can keep that true because it re-renders
    on every page load. An email is built once and read whenever it is
    opened, so a countdown in one is a number that was right at send and
    wrong by morning.
  */
  it('says nothing about how soon anything is', () => {
    const html = block([{ ...EVENT, startTime: new Date(NOW.getTime() + 36 * 60_000) }], []);
    expect(html).not.toMatch(/Starts in|Tomorrow|In \d+ days|\bToday\b/);
  });

  it('still prints the date, which does not go stale', () => {
    expect(block([EVENT], [])).toContain('Sun, Nov 1');
  });
});

describe('the accent reads on white and on itself', () => {
  it('darkens a pale brand colour until it can be read', () => {
    // A pale colour at 14px on white is a decoration, not a date.
    expect(accentText('#9ad3ff')).not.toBe('#9ad3ff');
    expect(accentText('#1a1a1a')).toBe('#1a1a1a');
  });

  it('keeps a readable colour as it is', () => {
    expect(accentText('#b03030')).toBe('#b03030');
  });

  it('picks dark text on a pale accent and light on a dark one', () => {
    expect(onAccent('#f5e663')).toBe('#1a1a1a');
    expect(onAccent('#b03030')).toBe('#ffffff');
  });

  it('falls back rather than emitting a broken colour', () => {
    expect(accentText('not-a-colour')).toBe(DEFAULT_ACCENT);
    expect(onAccent('not-a-colour')).toBe('#ffffff');
    expect(accentText('#b33')).toBe(accentText('#bb3333'));
  });
});

describe('an excerpt is cut on a word', () => {
  it('leaves a short description alone', () => {
    expect(clamp('Short', 220)).toBe('Short');
  });

  it('cuts on a space, not mid-syllable', () => {
    const out = clamp('a'.repeat(10) + ' ' + 'b'.repeat(300), 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('ab');
  });

  it('cuts hard rather than losing most of the text to one long word', () => {
    // A word boundary too far back is worse than no boundary.
    expect(clamp('x'.repeat(100), 40)).toBe('x'.repeat(40) + '…');
  });

  it('is unbothered by nothing at all', () => {
    expect(clamp(null, 40)).toBe('');
    expect(clamp(undefined, 40)).toBe('');
  });
});

const THEME = {
  accent: '#afd2e9',
  text: accentText('#afd2e9'),
  label: 'MaybeItsFate',
  timeZone: 'America/New_York',
};
