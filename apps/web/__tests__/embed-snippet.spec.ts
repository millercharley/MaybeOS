import { DEFAULT_ACCENT, embedSnippet, normaliseHex } from '@/lib/embed-snippet';

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
