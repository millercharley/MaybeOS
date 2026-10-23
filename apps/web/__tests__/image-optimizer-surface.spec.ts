import { readFileSync } from 'fs';
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
const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the image optimizer', () => {
  it('allows no remote host at all', () => {
    expect(code.replace(/\s+/g, '')).toContain('remotePatterns:[]');
  });

  it.each(['**', '*', 'hostname: "**"', "hostname: '**'"])(
    'never opens up to %s',
    (wildcard) => {
      expect(code).not.toContain(wildcard);
    },
  );

  /**
   * If this fails, somebody added a `next/image` with a remote `src`. That is
   * fine — but it needs its host named in `remotePatterns`, and naming a host
   * is a decision worth making deliberately rather than by wildcard.
   */
  it('nothing needs a remote host yet', () => {
    const { readdirSync, statSync } = require('fs') as typeof import('fs');
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
