import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Taking an address back, from the roster (MEM-28).
 *
 * Charley removed Evan's non-paying duplicate and then could not give the
 * correct address to the paying one: "another member already uses that
 * address. Check whether they have two accounts here." He didn't — one of them
 * was the account he had just removed, and the advice could not be followed.
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

describe('when a save is blocked by a removed account', () => {
  it('asks what taking the address back would involve', () => {
    expect(page).toMatch(/api\.members\s*\n?\s*\.previewTakeover\(/);
  });

  it('only asks when it was the address that was refused', () => {
    // A name clash is not a thing this can fix.
    expect(page).toMatch(/if \(changes\.email && \/removed\/i\.test\(message\)\)/);
  });

  it('shows what the removed account still holds before offering the button', () => {
    // The husk is rarely empty — one held three hundred shares.
    expect(page).toMatch(/\{takeover\.message\}/);
    expect(page).toMatch(/>\s*\{takingOver \? 'Taking it over…' : 'Take the address and what it holds'\}\s*</);
  });

  it('says it cannot be undone and that it is recorded', () => {
    expect(page).toMatch(/cannot be undone/);
    expect(page).toMatch(/audit log/);
  });

  it('offers a way to decline', () => {
    expect(page).toMatch(/>\s*Leave it\s*</);
  });

  it('shows the refusal plainly when it cannot be taken', () => {
    // `can: false` is an answer, not an error — the address may belong to a
    // live member, or to an account somebody signs in with.
    expect(page).toMatch(/takeover\.can \?/);
  });
});

describe('after taking it', () => {
  it('does not try to save the address again', () => {
    // The takeover sets it itself; sending it a second time would be refused
    // as unchanged and read to the admin as a failure.
    const fn = page.slice(page.indexOf('async function confirmTakeover'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/takeOverAddress\(/);
    expect(body).not.toMatch(/updateIdentity\([^)]*email/);
  });

  it('still saves a name edited in the same dialog', () => {
    const fn = page.slice(page.indexOf('async function confirmTakeover'));
    expect(fn.slice(0, 1600)).toMatch(/\{ name \}/);
  });

  it('re-reads the roster rather than patching the row', () => {
    const fn = page.slice(page.indexOf('async function confirmTakeover'));
    expect(fn.slice(0, 1600)).toMatch(/refetch\(\)/);
  });
});

describe('the offer does not outlive its dialog', () => {
  it('is cleared when the dialog closes', () => {
    // Otherwise a stale offer greets the next member opened.
    expect(page).toMatch(/setTakeover\(null\);\s*\n\s*\}\s*\n\s*\}\}/);
  });

  it('is cleared when a fresh save is attempted', () => {
    expect(page).toMatch(/setEditError\(''\);\s*\n\s*setTakeover\(null\);/);
  });
});
