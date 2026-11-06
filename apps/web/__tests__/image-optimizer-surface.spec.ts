import { stripComments } from './helpers/source-scan';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * What the image optimizer may fetch (SEC-10).
 *
 * `remotePatterns: [{ protocol: 'https', hostname: '**' }]` made
 * `/_next/image?url=…` an open image proxy: anyone, without signing in, could
 * have MaybeOS fetch and process a file from anywhere on the internet. In
 * October 2026 that became an unauthenticated RCE path — CVE-2026-96889, a
 * memory bug in the SVG renderer reached through `sharp` — and the optimizer
 * was how you reached it.
 *
 * The wildcard was granting a capability nothing used, which is the easiest
 * kind of hole to leave open and the easiest to reopen "just to get an image
 * working". Hence a test rather than a comment.
 */
const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
const code = stripComments(config);

describe('the image optimizer', () => {
  it('allows no remote host at all', () => {
    expect(code.replace(/\s+/g, '')).toContain('remotePatterns:[]');
  });

  /*
    Scoped to the `images` block (OPS-40).

    This used to assert that a bare `*` appeared nowhere in the whole file,
    which bans a character rather than a capability — `'/api/:path*'` in the
    rewrites is a route pattern and has nothing to do with what the optimizer
    may fetch.

    It passed anyway, because the stripper it used ran block comments first
    and a `/**` inside a line comment above opened a phantom one, blanking
    the rewrites out of the text being searched. A correct stripper made it
    fail on code that was never wrong. The rule survives; its reach was the
    mistake.
  */
  const imagesBlock = (() => {
    const at = code.indexOf('images:');
    expect(at).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf('},', at) + 2);
  })();

  it.each(['**', '*', 'hostname: "**"', "hostname: '**'"])(
    'never opens up to %s',
    (wildcard) => {
      expect(imagesBlock).not.toContain(wildcard);
    },
  );

  it('is looking at the images config and not an empty slice', () => {
    // A scoped assertion that scoped itself to nothing would pass forever.
    expect(imagesBlock).toContain('remotePatterns');
    expect(imagesBlock.length).toBeGreaterThan(20);
  });

  /**
   * If this fails, somebody added a `next/image` with a remote `src`. That is
   * fine — but it needs its host named in `remotePatterns`, and naming a host
   * is a decision worth making deliberately rather than by wildcard.
   */
  it('nothing needs a remote host yet', () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir))) {
        const rel = join(dir, entry);
        if (statSync(join(process.cwd(), rel)).isDirectory()) {
          if (entry !== 'node_modules' && entry !== '.next') walk(rel);
        } else if (/\.tsx$/.test(entry)) {
          const body = readFileSync(join(process.cwd(), rel), 'utf8');
          if (!/from 'next\/image'/.test(body)) continue;
          // A static import is a local file and never consults the list.
          if (/src=\{`?https?:/.test(body)) offenders.push(rel);
        }
      }
    };
    ['app', 'components'].forEach(walk);

    expect(offenders).toEqual([]);
  });
});
