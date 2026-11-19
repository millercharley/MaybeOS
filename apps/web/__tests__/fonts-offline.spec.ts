import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripComments } from './helpers/source-scan';
import { WEB, screenFiles } from './helpers/event-list-scan';

/**
 * A build must not depend on Google's CDN being up (OPS-45, and the CI card).
 *
 * `next/font/google` self-hosts what it fetches, which made the old note in
 * `layout.tsx` half true: the serving was local, the *fetching* happened
 * during `next build`. So an Actions network blip failed the build — which
 * it did on 11 November, and passed on a re-run with nothing changed.
 *
 * That is the part worth guarding. A build that fails on somebody else's
 * outage trains everyone to re-run it, and re-running is exactly the habit
 * that hides a real failure the first day there is one. The two cards here —
 * "stop fetching fonts at build time" and "CI fails at random on Google
 * Fonts" — were one bug.
 */
describe('the three faces come from disk, not from Google', () => {
  const layout = readFileSync(join(WEB, 'app', 'layout.tsx'), 'utf8');

  it('imports no font from next/font/google anywhere', () => {
    /*
      Across every screen, not just the layout: one `next/font/google` import
      in any file puts the fetch back into the build. Comments are stripped
      so the explanation in `layout.tsx` — which names the module on purpose
      — does not read as the thing it is explaining.
    */
    const offenders = screenFiles().filter((file) =>
      /from\s+'next\/font\/google'/.test(
        stripComments(readFileSync(join(WEB, file), 'utf8')),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('uses localFont for all three', () => {
    const code = stripComments(layout);

    expect(code).toMatch(/import localFont from 'next\/font\/local'/);
    expect(code.match(/localFont\(/g) ?? []).toHaveLength(3);
  });

  it('points at files that are actually there', () => {
    /*
      The paths have to be literal strings — `localFont` is a build-time
      transform, not a runtime call — so nothing can resolve them for us and
      a typo or a @fontsource rename would surface only as a failed build,
      which is the failure mode this whole change exists to remove.

      Resolved from `app/`, where the import sits.
    */
    const paths = [...stripComments(layout).matchAll(/path:\s*'([^']+\.woff2)'/g)].map(
      (hit) => hit[1],
    );

    expect(paths.length).toBe(8);

    for (const relative of paths) {
      expect({ relative, there: existsSync(resolve(WEB, 'app', relative)) }).toEqual({
        relative,
        there: true,
      });
    }
  });

  it('covers every weight the design system asks for', () => {
    // Archivo 400/500/600/700, Young Serif 400, Plex Mono 400/500/600 — the
    // set the old next/font/google call declared. A missing weight does not
    // fail a build; the browser synthesises a fake bold and it looks wrong.
    const code = stripComments(layout);
    const weightsFor = (family: string) =>
      [...code.matchAll(new RegExp(`${family}-latin-(\\d+)-normal`, 'g'))].map((m) => m[1]);

    expect(weightsFor('archivo')).toEqual(['400', '500', '600', '700']);
    expect(weightsFor('young-serif')).toEqual(['400']);
    expect(weightsFor('ibm-plex-mono')).toEqual(['400', '500', '600']);
  });

  it('keeps the packages pinned in the web workspace', () => {
    // node_modules is not committed, so the lockfile is what makes the files
    // above reproducible on a fresh CI checkout.
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'));

    for (const name of ['@fontsource/archivo', '@fontsource/young-serif', '@fontsource/ibm-plex-mono']) {
      expect(pkg.dependencies).toHaveProperty(name);
    }
  });
});
