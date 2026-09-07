import { readFileSync } from 'fs';
import { join } from 'path';
import { linkHtml, renderBodyHtml } from '@/lib/rich-text';
import { sanitizeWikiHtml } from '@/lib/wiki-html';

/**
 * Links survive from the composer to the page (CNT-02).
 *
 * Charley: "Hyperlinks aren't saving in the body of the handbook editor."
 *
 * The loss was in the composer, not in storage or rendering — both of those
 * were checked first and keep anchors intact. `window.prompt` moves focus out
 * of the `contentEditable` and collapses the selection, so by the time
 * `document.execCommand('createLink')` ran there was nothing to wrap.
 *
 * Reproduced in a real browser before the fix. Selecting
 * "maybeitsfate.circle.so" and linking it left those words plain and put
 * `<a href="…">https://…</a>` at the very start of the article instead — the
 * collapsed caret, which had gone back to position 0.
 *
 * `execCommand` does not exist in jsdom, so the range handling itself is
 * pinned by reading the source. What can be tested properly is tested
 * properly.
 */
describe('an anchor, once written', () => {
  it('survives sanitising', () => {
    const html = '<p>Visit <a href="https://maybeitsfate.circle.so">the community</a>.</p>';
    expect(sanitizeWikiHtml(html)).toContain('href="https://maybeitsfate.circle.so"');
  });

  it('survives the reader, including out of a contentEditable’s divs', () => {
    // The shape the browser actually stores (CNT-01).
    const stored = '<div>Visit <a href="https://maybeitsfate.circle.so">here</a> to book.</div>';
    expect(renderBodyHtml(stored)).toContain('<a href="https://maybeitsfate.circle.so">here</a>');
  });
});

describe('linking with nothing selected', () => {
  it('inserts the address as its own link', () => {
    // `createLink` on a collapsed selection does nothing at all, so the button
    // looked broken rather than failing.
    expect(linkHtml('https://maybeitsfate.circle.so')).toBe(
      '<a href="https://maybeitsfate.circle.so">https://maybeitsfate.circle.so</a>',
    );
  });

  it('cannot be talked out of the href attribute', () => {
    // The composer refuses anything that is not http(s):// with no
    // whitespace. That does not exclude a quote, and a quote is all it takes.
    const nasty = 'https://a.example/"onmouseover="alert(1)';
    const html = linkHtml(nasty);

    expect(html).toContain('&quot;');
    // The test that matters is "not an attribute", not "the word is absent" —
    // `onmouseover` legitimately appears inside the href and the link text,
    // escaped and inert, and asserting its absence fails on the safe output.
    expect(html).not.toMatch(/\sonmouseover=/);
    expect(sanitizeWikiHtml(html)).not.toMatch(/\sonmouseover=/);
  });
});

describe('the selection the prompt takes away', () => {
  const source = readFileSync(
    join(process.cwd(), 'components', 'composer', 'rich-composer.tsx'),
    'utf8',
  );

  it('is saved before the prompt opens', () => {
    const addLink = /function addLink\(\)[\s\S]*?\n  }/.exec(source)![0];
    expect(addLink.indexOf('cloneRange()')).toBeLessThan(addLink.indexOf('window.prompt'));
  });

  it('is put back before the command runs', () => {
    const addLink = /function addLink\(\)[\s\S]*?\n  }/.exec(source)![0];
    expect(addLink.indexOf('addRange(saved)')).toBeLessThan(addLink.indexOf('execCommand'));
  });

  it('is not assumed to exist', () => {
    // A collapsed or absent range takes the insert path rather than a
    // createLink that silently does nothing.
    expect(source).toContain('!saved || saved.collapsed');
  });
});
