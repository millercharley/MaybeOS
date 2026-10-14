import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeWikiHtml } from '@/lib/wiki-html';

/**
 * A picture inside a handbook article (BEL-13).
 *
 * Charley: "I need to add an image in-line in this Handbook post. Enable the
 * ability to add an image to a Handbook article."
 *
 * In-line, not attached underneath: a page explaining where the door reader
 * is wants the photograph next to the sentence about it.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const composer = read('components', 'composer', 'rich-composer.tsx');
const editor = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'handbook', 'page.tsx');

describe('the sanitiser keeps what the picture needs', () => {
  it('keeps the stored path, which is the durable half', () => {
    /*
      `src` is a signed link worth nothing tomorrow. Strip `data-path` and
      the picture is orphaned the first time an admin saves the article,
      because the body would come back carrying only an expiring URL.
    */
    const out = sanitizeWikiHtml(
      '<img src="https://signed.example/a?token=t" data-path="org/article-body/a.jpg" alt="Door" />',
    );

    expect(out).toContain('data-path="org/article-body/a.jpg"');
    expect(out).toContain('alt="Door"');
  });

  it('still refuses a javascript: source on one', () => {
    // Allowing an attribute must not quietly allow a scheme with it.
    expect(sanitizeWikiHtml('<img src="javascript:steal()" data-path="p" />')).not.toContain(
      'javascript:',
    );
  });

  it('still drops a script beside it', () => {
    const out = sanitizeWikiHtml('<img data-path="p" /><script>steal()</script>');
    expect(out).not.toContain('steal');
  });
});

describe('the composer', () => {
  it('writes both halves: the link to show and the path to keep', () => {
    expect(composer).toMatch(/src="\$\{stored\.url\}" data-path="\$\{stored\.path\}"/);
  });

  it('puts it where the caret is, which is what in-line means', () => {
    // Not appended underneath like an attachment.
    expect(composer).toMatch(/document\.execCommand\(\s*'insertHTML'/);
    expect(composer).toMatch(/editor\.current\?\.focus\(\);/);
  });

  it('is off unless the caller can store a picture', () => {
    // A message has no id to file an upload against until it exists.
    expect(composer).toMatch(/const canInsertImage = Boolean\(onInsertImage\)/);
    expect(composer).toMatch(/\{canInsertImage && \(/);
  });

  it('says so rather than failing silently', () => {
    expect(composer).toMatch(/setFileError\(/);
  });
});

describe('the handbook editor', () => {
  it('offers it once the article exists', () => {
    // The upload is filed against the article, and a draft never saved has
    // no id to file against.
    expect(editor).toMatch(/editing\.id && token && orgId/);
    expect(editor).toMatch(/addArticleBodyImage\(/);
  });

  it('says why when it cannot yet', () => {
    expect(editor).toMatch(/Save once and you can add pictures to the text/);
  });
});
