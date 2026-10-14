import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A link that opens one handbook article (BEL-14).
 *
 * Charley: "It would be nice to reference a Handbook article in the Commons
 * and readers can simply click on a link to jump directly into the Handbook
 * with this article open to read."
 *
 * The handbook opens everything in a modal over the list, so every article
 * shared one address. Pointing somebody at one meant describing where to
 * scroll.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const page = read('app', '(app)', 'portal', '[orgSlug]', 'handbook', 'page.tsx');
const modal = read('components', 'belonging', 'article-modal.tsx');

describe('the address follows what is on screen', () => {
  it('names the article when one is opened', () => {
    expect(page).toMatch(/router\.replace\(`\$\{pathname\}\?article=\$\{encodeURIComponent\(article\.slug\)\}`/);
  });

  it('uses the slug, which is what somebody pastes', () => {
    // The API takes either, so an older link holding an id still works.
    expect(page).toMatch(/encodeURIComponent\(article\.slug\)/);
  });

  it('clears it again when the article is closed', () => {
    // Otherwise Back and a refresh would both reopen what was just dismissed.
    expect(page).toMatch(/const closeArticle = \(\) => \{/);
    expect(page).toMatch(/onClose=\{closeArticle\}/);
  });

  it('does not scroll the list out from under the reader', () => {
    expect(page).toMatch(/\{ scroll: false \}/);
  });
});

describe('arriving by link', () => {
  it('opens what the link asked for', () => {
    expect(page).toMatch(/const wanted = params\?\.get\('article'\) \?\? null;/);
    expect(page).toMatch(/api\.belonging[\s\S]{0,30}\.article\(org\.id, wanted, token\)/);
  });

  it('does not reopen what the reader just closed', () => {
    // The effect is keyed on the slug, and the close clears the address, so
    // there is nothing left asking for it.
    expect(page).toMatch(/open\?\.slug === wanted\) return;/);
  });

  it('leaves them in the handbook if the article is gone', () => {
    // A deleted article, or one this member cannot see, is not an error
    // page — it is a handbook with that article missing.
    const at = page.indexOf('const wanted');
    expect(page.slice(at)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('getting the link', () => {
  it('offers one from the article itself', () => {
    expect(modal).toMatch(/Copy link/);
    expect(modal).toMatch(/navigator\.clipboard\.writeText\(window\.location\.href\)/);
  });

  it('copies what is actually on screen, not a rebuilt guess', () => {
    // The page puts the article in the address as it opens, so reading it
    // back cannot disagree with what the reader is looking at.
    expect(modal).not.toMatch(/`\$\{.*origin.*\}\/portal/);
  });

  it('says it worked', () => {
    expect(modal).toMatch(/Copied/);
  });

  it('does not raise an error when the clipboard is refused', () => {
    // Browsers can refuse it, and a handbook is not worth a banner.
    const at = modal.indexOf('async function copyLink');
    expect(modal.slice(at, at + 400)).toMatch(/catch \{/);
  });
});
