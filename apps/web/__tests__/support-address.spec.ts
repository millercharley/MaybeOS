import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';

/**
 * One support address, in one place (PLT-04).
 *
 * There is no "view as" in MaybeOS, and that is a decision: a platform admin
 * seeing what a member sees is the practical answer to "the button doesn't
 * work" and is also the privacy rule with a door in it. PLT-01 spent its whole
 * design closing that door. So the support mechanism is a screenshot sent to
 * an address — which makes **the address load-bearing**, not decorative. A
 * co-op that cannot find it has no way to report anything.
 *
 * An address copied into three components is an address that gets changed in
 * two of them, so it lives in one module and this asserts it stays there.
 */
describe('the support address', () => {
  const WEB_ROOT = join(__dirname, '..');
  const SOURCE = join('lib', 'support.ts');

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(join(WEB_ROOT, root));

  it('is written out in exactly one module', () => {
    const literals = files.filter(
      (f) =>
        relative(WEB_ROOT, f) !== SOURCE &&
        readFileSync(f, 'utf8').includes('support@maybeos.org'),
    );

    expect(literals.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });

  it('reaches an organiser where they are stuck, not only in settings', () => {
    // An admin who hits a broken screen does not navigate to Settings to find
    // out where to report it.
    const errorPage = readFileSync(join(WEB_ROOT, 'app', 'error.tsx'), 'utf8');

    expect(errorPage).toMatch(/SUPPORT_EMAIL/);
    expect(errorPage).toMatch(/screenshot/i);
  });

  it('names the co-op in the subject, so support knows who is writing', () => {
    expect(supportMailto('MaybeItsFate')).toContain('MaybeItsFate');
    expect(supportMailto()).toContain(`mailto:${SUPPORT_EMAIL}`);
  });

  it('says why a screenshot, not just that we want one', () => {
    // A co-op that knows MaybeOS cannot look inside its account understands
    // why it is asked to describe the problem rather than hand over access.
    const panel = readFileSync(join(WEB_ROOT, 'components', 'settings', 'support.tsx'), 'utf8');

    expect(panel).toMatch(/cannot look inside your co-op/i);
    expect(panel).toMatch(/audit log/i);
  });
});
