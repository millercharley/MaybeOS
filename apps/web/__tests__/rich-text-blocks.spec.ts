import { renderBodyHtml } from '@/lib/rich-text';

/**
 * What a contentEditable actually stores, and how it has to read back (CNT-01).
 *
 * Charley's Code of Conduct rendered as "…risk expulsion from the
 * cooperative.1. We are all in this together…" — the paragraph break gone,
 * while the admin editor showed it correctly. The cause is one line of
 * allowlist: a browser wraps each line of a contentEditable in a `<div>`,
 * `div` was not allowed, and DOMPurify keeps a disallowed element's children.
 *
 * The fixture is the real stored body, abbreviated: nested divs, `<br>`
 * spacers on some lines and a pasted zero-width joiner on others — which is
 * why only the first few items ran together.
 */
const STORED =
  "<b>We're in this together.</b><div><b><br></b>" +
  '<div>This code will evolve and be posted throughout the club.</div>' +
  '<div>‍</div>' +
  '<div>1. We are all in this together.</div>' +
  '<div>‍</div>' +
  '<div>2. Let’s respect each other.</div>' +
  '<div><br></div>' +
  '<div>3. Let&#39;s be tolerant of productive conversations.</div>' +
  '</div>';

describe('a body written in a contentEditable', () => {
  const html = renderBodyHtml(STORED);

  it('keeps every line apart', () => {
    // The whole bug in one assertion: this ran together as "club.1. We are".
    expect(html).not.toMatch(/club\.\s*1\./);
    expect(html).not.toMatch(/together\.\s*2\./);
  });

  it('renders each line as a paragraph', () => {
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.length).toBe(4);
  });

  it('does not nest them, whatever the browser nested', () => {
    // The stored body wraps everything in an outer div. Nested paragraphs
    // would take the spacing rule, which is `> * + *`, out of reach.
    // A `<p` reached before the current one closes would be a nested one.
    expect(html).not.toMatch(/<p[^>]*>(?:(?!<\/p>)[\s\S])*<p/);
  });

  it('drops the blank lines that were doing the spacing by hand', () => {
    // The reader adds a paragraph's margin; keeping the empty block too would
    // double every gap.
    expect(html).not.toMatch(/<p[^>]*>(<br\s*\/?>|\s|‍)*<\/p>/);
  });

  it('hangs the indent on the lines the author numbered', () => {
    expect(html).toContain('<p class="rich-num">1. We are all in this together.</p>');
    expect(html).toContain('<p class="rich-num">2.');
  });

  it('leaves an unnumbered paragraph alone', () => {
    expect(html).toContain('<p>This code will evolve');
  });

  it('still keeps the co-op’s own words exactly', () => {
    // Including the curly apostrophes, which are theirs.
    expect(html).toContain('Let’s respect each other.');
    expect(html).toContain("Let's be tolerant");
  });
});

describe('what must not change', () => {
  it('still escapes a plain-text body', () => {
    expect(renderBodyHtml('a < b')).toBe('a &lt; b');
  });

  it('still strips a script', () => {
    expect(renderBodyHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });

  it('does not let an author smuggle in a class', () => {
    // The indent class is ours and added after sanitising; nothing the author
    // writes survives as an attribute.
    expect(renderBodyHtml('<p class="evil">1. x</p>')).toBe('<p class="rich-num">1. x</p>');
  });

  it('keeps a real list as a list', () => {
    const html = renderBodyHtml('<ol><li>one</li><li>two</li></ol>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>two</li>');
  });

  it('keeps a paragraph that holds only an image', () => {
    expect(renderBodyHtml('<p><img src="/a.png"></p>')).toContain('<img');
  });
});
