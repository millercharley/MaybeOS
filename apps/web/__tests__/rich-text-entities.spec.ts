import { renderBodyHtml, decodeComposerEntities } from '@/lib/rich-text';

/**
 * Entities a browser leaves behind in a body with no tags (CMN-26).
 *
 * Charley: 'Weird bug with text in some posts in Commons. Probably an
 * apostrophe. "Hi all! The new system looks awesome.&nbsp;"'
 *
 * It was not the apostrophe. A contentEditable writes `&nbsp;` for a space it
 * must not collapse — a double space, or one at the end of a line — and if
 * the member used no formatting, the stored body has that entity and no tag
 * at all. `looksLikeHtml` says no, correctly by its own rule, and the body is
 * escaped: `&nbsp;` becomes `&amp;nbsp;`, which renders as the literal text.
 *
 * Six bodies on production read that way.
 */
describe('a body written without any formatting', () => {
  /** The exact shape of the comment in MaybeItsFate's Events channel. */
  it('shows a non-breaking space as a space, not as "&nbsp;"', () => {
    const html = renderBodyHtml("Cool!&nbsp; I'll be there!");

    expect(html).not.toContain('&amp;nbsp;');
    expect(html).toContain(' ');
  });

  it('still escapes the markup a member actually typed', () => {
    // The reason the plain-text path exists at all: "a < b" must survive.
    expect(renderBodyHtml('a < b &nbsp; c')).toContain('&lt;');
    expect(renderBodyHtml('a < b &nbsp; c')).not.toContain('<b');
  });

  it('leaves a body with no entities exactly as it was', () => {
    expect(renderBodyHtml('Plain words, nothing special.')).toBe(
      'Plain words, nothing special.',
    );
  });

  it('keeps line breaks, which the plain-text path is there to preserve', () => {
    expect(renderBodyHtml('one\ntwo')).toBe('one\ntwo');
  });

  /**
   * A body that does carry tags goes to the sanitiser as before — these were
   * never broken, which is why the bug looked arbitrary.
   */
  it('does not change how a formatted body renders', () => {
    const html = renderBodyHtml('<p>Would love to join!&nbsp;</p>');

    expect(html).toContain('<p>');
    expect(html).not.toContain('&amp;nbsp;');
  });
});

describe('decodeComposerEntities', () => {
  it.each([
    ['&nbsp;', ' '],
    ['&#160;', ' '],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&quot;', '"'],
    ['&#39;', "'"],
    ['&amp;', '&'],
    ['&zwj;', ''],
  ])('decodes %s', (entity, expected) => {
    expect(decodeComposerEntities(entity)).toBe(expected);
  });

  /**
   * Order matters. Decoding `&amp;` first turns `&amp;lt;` — an ampersand the
   * member typed, followed by "lt;" — into a `<` they never wrote.
   */
  it('does not turn a typed ampersand into markup', () => {
    expect(decodeComposerEntities('&amp;lt;')).toBe('&lt;');
    expect(renderBodyHtml('Tom &amp;lt; Jerry')).toContain('&amp;lt;');
  });

  /**
   * Deliberately only the handful a contentEditable emits. Decoding
   * everything would give a member who typed `&copy;` a © they did not ask
   * for.
   */
  it('leaves entities a browser would not have written', () => {
    expect(decodeComposerEntities('&copy; &mdash; &hearts;')).toBe('&copy; &mdash; &hearts;');
  });
});
