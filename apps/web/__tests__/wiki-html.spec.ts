import { sanitizeWikiHtml } from '@/lib/wiki-html';

/**
 * Wiki page bodies are HTML written by a co-op's admins and, since CMN-06,
 * read by every one of its members.
 *
 * While the wiki was admin-only the audience and the authors were the same
 * people, so raw HTML cost nothing. Opening it to members widened that — and
 * self-serve signup (SCL-02) means becoming an admin somewhere takes a
 * registration form, so "admin-authored" stopped implying "trusted".
 */
describe('sanitizeWikiHtml', () => {
  it('keeps the formatting a wiki page is actually made of', () => {
    const html =
      '<h2>House Rules</h2><p>Quiet hours after <strong>9pm</strong>.</p><ul><li>Tidy up</li></ul>';

    expect(sanitizeWikiHtml(html)).toBe(html);
  });

  it('keeps ordinary links and images', () => {
    const out = sanitizeWikiHtml('<a href="https://example.org" title="t">docs</a>');
    expect(out).toContain('href="https://example.org"');
  });

  it('strips script tags', () => {
    const out = sanitizeWikiHtml('<p>Hi</p><script>steal(document.cookie)</script>');

    expect(out).toContain('<p>Hi</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('steal');
  });

  it('strips inline event handlers', () => {
    // The likeliest real shape: an admin pastes markup carrying an onerror.
    const out = sanitizeWikiHtml('<img src="x" onerror="steal(document.cookie)">');

    expect(out).not.toContain('onerror');
    expect(out).not.toContain('steal');
  });

  it('strips javascript: URLs', () => {
    const out = sanitizeWikiHtml('<a href="javascript:steal()">click</a>');

    expect(out).not.toContain('javascript:');
  });

  it('drops iframes and object embeds', () => {
    const out = sanitizeWikiHtml('<iframe src="https://evil.example"></iframe><object data="x"></object>');

    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
  });

  it('survives empty and malformed input rather than throwing', () => {
    // A half-written page must render as a page, not as a crashed one.
    expect(sanitizeWikiHtml('')).toBe('');
    expect(() => sanitizeWikiHtml('<p>unclosed')).not.toThrow();
  });
});
