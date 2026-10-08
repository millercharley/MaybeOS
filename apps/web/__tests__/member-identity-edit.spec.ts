import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Correcting a member's name or address, from the roster (MEM-27).
 *
 * Until now the only way to change either was a spreadsheet re-import, and the
 * only editable address in MaybeOS was on the bounce list — reachable solely
 * by first having an address fail. A roster that came out of a CSV is full of
 * "SMITH, JANE" and domains with a typo in them.
 */
const page = readFileSync(
  join(
    __dirname,
    '..',
    'app',
    '(app)',
    '(dashboard)',
    'admin',
    '[orgSlug]',
    'members',
    'page.tsx',
  ),
  'utf8',
)
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('the members list', () => {
  it('offers the edit from a member’s own row', () => {
    expect(page).toMatch(/>\s*Edit name or email\s*</);
  });

  it('opens it filled in with what is already there', () => {
    // Most corrections are a spelling. Retyping from an empty box is how a
    // second mistake gets in.
    expect(page).toMatch(/name: openMenu\.member\.user\.name \?\? ''/);
    expect(page).toMatch(/email: openMenu\.member\.user\.email \?\? ''/);
  });

  it('sends only what actually changed', () => {
    /*
      The point of the whole guard.

      An address change resets what MaybeOS knows about reaching somebody — a
      new address has never been written to. Sending the address unchanged
      alongside a name fix would throw that away for a member who is perfectly
      reachable.
    */
    expect(page).toMatch(/if \(name && name !== \(editing\.member\.user\.name \?\? ''\)\)/);
    expect(page).toMatch(/email\.toLowerCase\(\) !== \(editing\.member\.user\.email \?\? ''\)\.toLowerCase\(\)/);
  });

  it('does not call the API when nothing is different', () => {
    expect(page).toMatch(/Object\.keys\(changes\)\.length === 0/);
  });

  it('says what changing the address actually does', () => {
    // It is not the same size of act as fixing a spelling, and the difference
    // is invisible in two identical text boxes.
    expect(page).toMatch(/what they sign in with/);
    expect(page).toMatch(/need\s*\n?\s*a new link/);
  });

  it('re-reads the list rather than patching the row', () => {
    // The list is paged and filtered, and a corrected name may no longer match
    // the search it was found by.
    const save = page.slice(page.indexOf('async function saveEdit'));
    expect(save.slice(0, 1400)).toMatch(/refetch\(\)/);
  });

  it('keeps the destructive action separate and below', () => {
    expect(page.indexOf('Edit name or email')).toBeLessThan(
      page.indexOf('Remove from the community'),
    );
  });
});
