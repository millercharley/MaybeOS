import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_ACCENT, embedSnippet, normaliseHex, resolveAccent } from '@/lib/embed-snippet';

/**
 * The snippet an organiser copies (EVT-21).
 *
 * Imported from the same module the settings card uses, not re-implemented
 * here: a copy of the logic would let this pass while the card handed out
 * something different, which is the only failure that matters.
 */
const snippetFor = embedSnippet;

describe('the accent colour', () => {
  it('accepts a hex with or without the hash', () => {
    expect(normaliseHex('#1A2B3C')).toBe('#1a2b3c');
    expect(normaliseHex('1a2b3c')).toBe('#1a2b3c');
    expect(normaliseHex('  #abc  ')).toBe('#abc');
  });

  it('refuses anything that is not a colour', () => {
    // The failure this stops: "#b0" copied into a co-op's website, where it
    // does nothing and nobody knows why.
    expect(normaliseHex('#b0')).toBeNull();
    expect(normaliseHex('red')).toBeNull();
    expect(normaliseHex('#gggggg')).toBeNull();
    expect(normaliseHex('')).toBeNull();
  });
});

/**
 * Where a colour field starts (BRD-03).
 *
 * Charley: "There are a lot of places in the admin to set an accent color.
 * Make sure the Brand Color setting inside Branding is the core place to set
 * this." Before this, every embed card opened on MaybeOS's own red, so a co-op
 * that had already chosen a colour had to type it again in each one — and
 * whatever they had not retyped went onto their website in our colour.
 */
describe('the colour a field starts on', () => {
  it('is the co-op’s brand colour', () => {
    expect(resolveAccent('#afd2e9')).toBe('#afd2e9');
    expect(resolveAccent('AFD2E9')).toBe('#afd2e9');
  });

  it('falls back to the script’s own default when there is nothing to inherit', () => {
    // A co-op with no colour set, and the case where somebody has stored
    // something that is not a colour at all.
    expect(resolveAccent(null)).toBe(DEFAULT_ACCENT);
    expect(resolveAccent('')).toBe(DEFAULT_ACCENT);
    expect(resolveAccent('cornflower')).toBe(DEFAULT_ACCENT);
  });

  it('still writes the attribute for a brand colour that is not the default', () => {
    // The snippet omits data-accent only when the colour equals what embed.js
    // paints with unattributed. Seeding from the brand colour must therefore
    // put the attribute back, or a co-op's website would render in our red.
    const s = snippetFor('https://maybeos.org', 'x', resolveAccent('#afd2e9'));
    expect(s).toContain('data-accent="#afd2e9"');
  });
});

describe('the snippet', () => {
  const origin = 'https://maybeos.org';

  it('is one script tag', () => {
    const s = snippetFor(origin, 'maybeitsfate', DEFAULT_ACCENT);
    expect(s.match(/<script/g)).toHaveLength(1);
    expect(s).toContain('defer');
  });

  it('leaves the accent out when it is the default', () => {
    // A co-op that never touched the colour should not be handed an attribute
    // to wonder about.
    expect(snippetFor(origin, 'maybeitsfate', DEFAULT_ACCENT)).not.toContain('data-accent');
  });

  it('carries the accent once it is set', () => {
    expect(snippetFor(origin, 'maybeitsfate', '#1a2b3c')).toContain('data-accent="#1a2b3c"');
  });

  it('never carries a half-typed colour', () => {
    expect(snippetFor(origin, 'maybeitsfate', '#b0')).not.toContain('data-accent');
  });

  /**
   * A second embed shares the file (PUB-01), so the events snippet has to keep
   * being byte-for-byte what it was: the tag is already pasted on real
   * websites, and `data-show` absent means events there.
   */
  it('says nothing about what to show, for events', () => {
    expect(snippetFor(origin, 'maybeitsfate', DEFAULT_ACCENT)).toBe(
      '<script src="https://maybeos.org/embed.js" data-org="maybeitsfate" defer></script>',
    );
  });

  it('asks for membership when that is what the admin copied', () => {
    const s = snippetFor(origin, 'maybeitsfate', DEFAULT_ACCENT, 'membership');
    expect(s).toContain('data-show="membership"');
    expect(s.match(/<script/g)).toHaveLength(1);
  });

  it('carries the accent onto the membership tag too', () => {
    expect(snippetFor(origin, 'maybeitsfate', '#1a2b3c', 'membership')).toContain(
      'data-accent="#1a2b3c"',
    );
  });

  it('points at the host it was generated from, not a hardcoded one', () => {
    // So a staging copy never hands out a production snippet.
    expect(snippetFor('https://staging.example', 'x', DEFAULT_ACCENT)).toContain(
      'https://staging.example/embed.js',
    );
  });
});

/**
 * The header above the prices (PUB-03).
 *
 * Charley, having put the cards on maybeitsfate.com/join: "Just showing the
 * pricing cards doesn't work. The page needs more context."
 *
 * `embed.js` is a plain script with no module system, so it is read as text —
 * which is also the honest test of a file that runs on somebody else's
 * website, where a syntax error is a blank space on their join page.
 */
describe('the membership embed', () => {
  const script = readFileSync(join(__dirname, '..', 'public', 'embed.js'), 'utf8');

  it('parses', () => {
    // The whole file, as a browser would take it.
    expect(() => new Function(script)).not.toThrow();
  });

  it('draws the context before the prices', () => {
    const header = script.indexOf('header(data)');
    const grid = script.indexOf("grid.className = 'tiers'");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(grid);
  });

  it('counts the figures rather than carrying typed ones', () => {
    // A co-op that writes "400+ members" onto their website is writing a
    // number that is wrong within a year, in the direction that makes them
    // look smaller than they are.
    for (const field of ['members', 'rooms', 'openEvents', 'allEvents']) {
      expect(script).toContain(`stats.${field}`);
    }
  });

  it('leaves out a figure it has nothing true to say about', () => {
    // A co-op with no rooms does not advertise nought rooms.
    expect(script).toContain('stats.rooms > 0');
    expect(script).toContain('stats.openEvents > 0');
  });

  it('shows the joining fee on the card, from the tier rather than a benefit', () => {
    // A co-op that changes the amount should not have to remember to change
    // a sentence somebody typed as well (PAY-10).
    expect(script).toContain('tier.initiationFeeCents > 0');
    expect(script).toContain('once, to join');
  });

  it('adds no headline of its own', () => {
    // The designer is adding the hero above this; two competing headlines on
    // one page is the thing that made the old page need rebuilding.
    expect(script).not.toMatch(/<h1|createElement\('h1'\)/);
  });
});

/**
 * The cards, on somebody else's website (PUB-04).
 *
 * Charley's co-op's brand colour is #afd2e9 — a pale blue, near enough his
 * own page's background that every accented thing vanished into it: the
 * highlighted card's pill read as plain text and the buttons read as links.
 * An embed has to look like itself on any page it lands on.
 */
describe('the membership cards', () => {
  const script = readFileSync(join(__dirname, '..', 'public', 'embed.js'), 'utf8');

  it('brings its own background, rather than showing the page through', () => {
    expect(script).toMatch(/\.tier \{[^']*background: #fff/);
  });

  it('fills the button with the legible accent, not the raw one', () => {
    // A pale brand colour makes a pale rectangle, which reads as a panel
    // rather than a control.
    expect(script).toMatch(/\.join a \{[^']*background: ' \+ accentText/);
  });

  it('draws the highlighted outline in the legible accent too', () => {
    expect(script).toMatch(/\.tier\.featured \{ border: 3px solid ' \+ accentText/);
  });

  it('makes room for the pill above every card, not by moving one', () => {
    /*
      The pill is absolutely positioned above the featured card's top edge.
      The room for it is made once on the grid, so the highlighted card's
      title still sits on the same line as its neighbours' — it used to carry
      a `margin-top`, which pushed its whole contents down.
    */
    expect(script).toMatch(/\.tiers \{[^']*padding-top: 14px/);
    expect(script).not.toMatch(/\.tier\.featured \{[^']*margin-top/);
  });

  it('gives a card room for a line of text to be a line', () => {
    // 15rem fitted five across on a wide page and turned every benefit into
    // two lines.
    expect(script).toMatch(/minmax\(20rem, 1fr\)/);
  });
});
