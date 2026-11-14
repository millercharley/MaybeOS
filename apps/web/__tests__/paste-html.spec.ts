import { normalizePastedHtml } from '@/lib/paste-html';
import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Pasting a written announcement and keeping it (CMP-01).
 *
 * Charley pasted a message with hyperlinks and bold into the admin Commons
 * composer, to post it and email it to 457 members, and every link and every
 * bold word was dropped. Deliberately: the composer inserted `text/plain`.
 *
 * These are the shapes real editors put on a clipboard, which is the whole
 * difficulty — bold almost never arrives as `<b>`. Written as fragments
 * because that is what `getData('text/html')` hands over.
 */
describe('what the editors people paste from actually send', () => {
  it('keeps bold that Google Docs spells as a font weight', () => {
    const out = normalizePastedHtml(
      '<span style="font-weight:700">Potluck Friday</span>',
    );
    expect(out).toContain('<strong>Potluck Friday</strong>');
  });

  /**
   * The trap that would have shipped a document in bold.
   *
   * Google Docs wraps its whole fragment in `<b style="font-weight:normal">`.
   * `<b>` is on the sanitiser's allowlist and `style` is not, so allowing
   * paste-through without this would keep the tag, drop the cancellation, and
   * embolden every word of every paste from Google Docs.
   */
  it('does not bold everything when Google Docs wraps it in a cancelled <b>', () => {
    const out = normalizePastedHtml(
      '<b style="font-weight:normal" id="docs-internal-guid-9f1">' +
        'Hello <span style="font-weight:700">everyone</span>' +
      '</b>',
    );

    expect(out).toContain('<strong>everyone</strong>');
    // The wrapper is gone, so "Hello" is not inside anything.
    expect(out).not.toMatch(/<(b|strong)[^>]*>Hello/);
  });

  it('cancels a Word <b style="font-weight:400"> the same way', () => {
    const out = normalizePastedHtml('<b style="font-weight:400">plain words</b>');
    expect(out).not.toMatch(/<(b|strong)\b/);
    expect(out).toContain('plain words');
  });

  /**
   * Word's own inside-out trap.
   *
   * `mso-bidi-font-weight:normal` sits beside the real `font-weight:bold`. A
   * regex that matched `font-weight` anywhere in the string would read the
   * `mso-` one and conclude the text is not bold.
   */
  it('reads Word past its mso- properties', () => {
    const out = normalizePastedHtml(
      `<span style='font-weight:bold;mso-bidi-font-weight:normal'>Board meeting</span>`,
    );
    expect(out).toContain('<strong>Board meeting</strong>');
  });

  it('keeps italic, underline and strikethrough from a style', () => {
    expect(normalizePastedHtml('<span style="font-style:italic">a</span>')).toContain('<em>a</em>');
    expect(normalizePastedHtml('<span style="text-decoration:underline">b</span>')).toContain('<u>b</u>');
    expect(normalizePastedHtml('<span style="text-decoration:line-through">c</span>')).toContain('<s>c</s>');
  });

  it('keeps one span that is bold and italic at once', () => {
    const out = normalizePastedHtml(
      '<span style="font-weight:700;font-style:italic">both</span>',
    );
    expect(out).toMatch(/<strong><em>both<\/em><\/strong>/);
  });

  /** A paragraph that is also bold is still a paragraph. */
  it('does not lose the block when the block itself is styled', () => {
    const out = normalizePastedHtml('<p style="font-weight:bold">A heading of sorts</p>');
    expect(out).toMatch(/<p><strong>A heading of sorts<\/strong><\/p>/);
  });

  it('keeps hyperlinks, which is half of what was asked for', () => {
    const out = normalizePastedHtml(
      '<a href="https://maybeitsfate.org/events" style="color:#1155cc">the calendar</a>',
    );
    expect(out).toContain('href="https://maybeitsfate.org/events"');
    expect(out).toContain('the calendar');
  });

  it('keeps a real list', () => {
    const out = normalizePastedHtml(
      '<ul><li><span style="font-weight:700">Bring</span> a dish</li><li>Arrive at six</li></ul>',
    );
    expect(out).toContain('<ul>');
    expect(out).toContain('<strong>Bring</strong>');
    expect(out).toContain('Arrive at six');
  });

  it('keeps headings', () => {
    expect(normalizePastedHtml('<h2>November</h2>')).toContain('<h2>November</h2>');
  });

  /**
   * Outlook and Apple Mail write a `<div>` per line, and the sanitiser drops a
   * `div` while keeping its contents — so without this the two lines arrive as
   * one run of words.
   */
  it('turns a div per line into paragraphs rather than one run', () => {
    const out = normalizePastedHtml('<div>First line</div><div>Second line</div>');
    expect(out).toBe('<p>First line</p><p>Second line</p>');
  });

  it('steps out of the way of a div that already holds blocks', () => {
    const out = normalizePastedHtml('<div><p>One</p><p>Two</p></div>');
    // Not <p><p>One</p>…</p>, which no serializer keeps.
    expect(out).toBe('<p>One</p><p>Two</p>');
  });
});

/**
 * The security boundary did not move.
 *
 * Normalising runs first and the sanitiser runs last, which is the one
 * ordering rule in this module. These assert the second half still happens.
 */
describe('what a clipboard is still not allowed to carry', () => {
  it('drops a script, and its contents with it', () => {
    const out = normalizePastedHtml('<p>Hi</p><script>steal()</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('steal');
  });

  it('drops a style block rather than rendering its text', () => {
    const out = normalizePastedHtml('<style>.x{color:red}</style><p>Hi</p>');
    expect(out).toBe('<p>Hi</p>');
  });

  it('refuses a javascript: link', () => {
    const out = normalizePastedHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('keeps no inline style, class or id through to the stored body', () => {
    const out = normalizePastedHtml(
      '<p style="background:#ff0" class="MsoNormal" id="x">Shaded in Word</p>',
    );
    expect(out).toBe('<p>Shaded in Word</p>');
  });

  it('drops an event handler', () => {
    const out = normalizePastedHtml('<p onclick="steal()">Hi</p>');
    expect(out).not.toContain('onclick');
  });

  it('drops Word’s own namespaced machinery', () => {
    const out = normalizePastedHtml('<p>Real words<o:p></o:p></p>');
    expect(out).toBe('<p>Real words</p>');
  });

  it('drops a conditional comment, which is where Word hides markup', () => {
    const out = normalizePastedHtml('<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>Hi</p>');
    expect(out).toBe('<p>Hi</p>');
  });
});

describe('an empty or useless clipboard', () => {
  /** `''` is the caller's signal to fall back to plain text. */
  it.each([
    ['nothing at all', ''],
    ['whitespace', '   \n  '],
    ['markup with nothing left after cleaning', '<style>.a{}</style>'],
  ])('answers empty for %s, so the caller pastes text instead', (_label, input) => {
    expect(normalizePastedHtml(input)).toBe('');
  });
});

/**
 * And the composer has to actually use it.
 *
 * A source scan: the behaviour is a branch inside a paste event, and this
 * app's harness renders no components. The rule being kept is that the HTML
 * path exists at all — it is the thing that was missing.
 */
describe('the composer', () => {
  const SOURCE = stripComments(
    readFileSync(join(__dirname, '..', 'components', 'composer', 'rich-composer.tsx'), 'utf8'),
  );

  it('really did strip its comments', () => {
    // The comment explains the plain-text fallback it replaced, so a scan for
    // `text/plain` would pass against the bug.
    expect(SOURCE).not.toContain('carries in');
  });

  it('reads the HTML flavour of the clipboard, not only the text', () => {
    expect(SOURCE).toContain("normalizePastedHtml(e.clipboardData.getData('text/html'))");
    expect(SOURCE).toContain("document.execCommand('insertHTML', false, html)");
  });

  it('still falls back to plain text when there is no usable HTML', () => {
    expect(SOURCE).toMatch(/else \{\s*document\.execCommand\('insertText', false, e\.clipboardData\.getData\('text\/plain'\)\)/);
  });
});
