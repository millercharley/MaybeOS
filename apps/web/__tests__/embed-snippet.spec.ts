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

  it('points at the host it was generated from, not a hardcoded one', () => {
    // So a staging copy never hands out a production snippet.
    expect(snippetFor('https://staging.example', 'x', DEFAULT_ACCENT)).toContain(
      'https://staging.example/embed.js',
    );
  });
});
