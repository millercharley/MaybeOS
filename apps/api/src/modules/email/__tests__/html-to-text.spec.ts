import { htmlToText } from '../html-to-text';

/**
 * The plain-text half (EML-02).
 *
 * The assertion that matters most is the one about links. Every message
 * MaybeOS sends exists to get somebody to a URL, and a text part that drops
 * it is worse than no text part at all — some clients prefer text, so the
 * broken half would be the half those members read.
 */
describe('rendering an email as plain text', () => {
  it('keeps the words', () => {
    expect(htmlToText('<p>Hello there</p>')).toBe('Hello there');
  });

  it('returns empty for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  describe('links', () => {
    it('keeps the destination beside the label', () => {
      expect(htmlToText('<a href="https://maybeos.org/x">Sign in</a>')).toBe(
        'Sign in (https://maybeos.org/x)',
      );
    });

    it('prints a bare URL once rather than twice', () => {
      const url = 'https://maybeos.org/magic-link?token=abc';
      expect(htmlToText(`<a href="${url}">${url}</a>`)).toBe(url);
    });

    it('reads a label wrapped in other markup', () => {
      expect(htmlToText('<a href="https://x.org"><strong>Book</strong> it</a>')).toBe(
        'Book it (https://x.org)',
      );
    });

    it.each([
      ['single quotes', `<a href='https://x.org'>Go</a>`],
      ['no quotes', `<a href=https://x.org>Go</a>`],
      ['other attributes first', `<a class="btn" href="https://x.org" id="g">Go</a>`],
    ])('finds the href with %s', (_why, html) => {
      expect(htmlToText(html)).toBe('Go (https://x.org)');
    });

    it('unescapes an href that was HTML-escaped on the way in', () => {
      expect(htmlToText('<a href="https://x.org/a?b=1&amp;c=2">Go</a>')).toBe(
        'Go (https://x.org/a?b=1&c=2)',
      );
    });

    /** The real one: a sign-in link must survive, whole. */
    it('carries a real sign-in link through intact', () => {
      const url = 'https://maybeos.org/magic-link?token=2f6b1c84-0f7a-4e52-9a1b-7c3d5e8f0012';
      const text = htmlToText(
        `<div><p>Hello Ruth,</p><p><a href="${url}">Sign in to MaybeItsFate</a></p></div>`,
      );

      expect(text).toContain(url);
      expect(text).toBe(`Hello Ruth,\n\nSign in to MaybeItsFate (${url})`);
    });
  });

  describe('structure', () => {
    it('separates paragraphs with a blank line', () => {
      expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    });

    it('breaks on <br>', () => {
      expect(htmlToText('One<br>Two<br />Three')).toBe('One\nTwo\nThree');
    });

    it('marks list items', () => {
      expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
    });

    it('does not run two blocks together into one word', () => {
      expect(htmlToText('<div>Cancelled:</div><div>The Attic</div>')).toBe(
        'Cancelled:\n\nThe Attic',
      );
    });

    it('collapses a run of empty blocks rather than printing a gulf', () => {
      expect(htmlToText('<p>One</p><p></p><p></p><p></p><p>Two</p>')).toBe('One\n\nTwo');
    });
  });

  describe('things that are not prose', () => {
    it('drops a style block and its contents', () => {
      expect(htmlToText('<style>body{color:red}</style><p>Hi</p>')).toBe('Hi');
    });

    it('drops a script block and its contents', () => {
      expect(htmlToText('<script>alert(1)</script><p>Hi</p>')).toBe('Hi');
    });

    it('strips tags it has no opinion about', () => {
      expect(htmlToText('<p>A <span class="x">b</span> c</p>')).toBe('A b c');
    });
  });

  describe('entities', () => {
    it.each([
      ['&amp;', '&'],
      ['&lt;', '<'],
      ['&gt;', '>'],
      ['&quot;', '"'],
      ['&#39;', "'"],
      ['&mdash;', '—'],
      ['&#x2014;', '—'],
    ])('decodes %s', (entity, char) => {
      expect(htmlToText(`<p>a${entity}b</p>`)).toBe(`a${char}b`);
    });

    it('turns a non-breaking space into a space, not a stray character', () => {
      expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
    });

    it('leaves an entity it does not know rather than mangling it', () => {
      expect(htmlToText('<p>a&notareal;b</p>')).toBe('a&notareal;b');
    });

    it('does not decode escaped markup into live tags', () => {
      // The templates escape user text, so `&lt;b&gt;` is somebody's typing,
      // not markup. Decoding before stripping would delete it.
      expect(htmlToText('<p>&lt;b&gt;bold&lt;/b&gt;</p>')).toBe('<b>bold</b>');
    });
  });

  it('never returns only whitespace for a message that had prose', () => {
    const text = htmlToText('<html><head><title>x</title></head><body><p>  Hi  </p></body></html>');
    expect(text).toBe('Hi');
  });
});
