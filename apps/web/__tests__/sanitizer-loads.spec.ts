import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sanitizeWikiHtml } from '@/lib/wiki-html';

/**
 * The sanitiser has to load, which is the part that kept failing (OPS-35).
 *
 * It was `isomorphic-dompurify`, which needs jsdom in Node. Bundled, jsdom
 * lost the stylesheet it reads at startup — `ENOENT: default-stylesheet.css`,
 * 1,988 times in five weeks. Marked external so the file would be traced in,
 * it then hit an ESM-only dependency being `require()`d from CommonJS. Both
 * failed on every server render of a page holding rich text.
 *
 * So the tests below are about loading rather than about sanitising. The
 * sanitising is covered by `wiki-html.spec.ts`, and the seven assertions
 * there passed unchanged through the swap.
 */
const root = join(__dirname, '..', '..', '..');

/** Walk a package's dependencies, wherever npm hoisted them. */
function treeOf(name: string, seen = new Set<string>()): { name: string; type: string }[] {
  if (seen.has(name)) return [];
  seen.add(name);

  for (const base of [join(root, 'node_modules'), join(__dirname, '..', 'node_modules')]) {
    const manifest = join(base, name, 'package.json');
    if (!existsSync(manifest)) continue;

    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const here = [{ name, type: pkg.type ?? 'commonjs' }];
    for (const dep of Object.keys(pkg.dependencies ?? {})) here.push(...treeOf(dep, seen));
    return here;
  }
  return [{ name, type: 'missing' }];
}

describe('loading it at all', () => {
  it('survives being required from CommonJS, which is how the function runs', () => {
    /*
      In a separate process with no bundler and no jsdom — the closest this
      suite gets to the Lambda. Jest resolves packages differently from Node,
      so asking Jest alone would not have caught the failure this replaces.
    */
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        "const {FilterXSS}=require('xss');" +
          "const f=new FilterXSS({whiteList:{p:[]},stripIgnoreTag:true,stripIgnoreTagBody:['script']});" +
          "process.stdout.write(f.process('<p>ok</p><script>bad()</script>'))",
      ],
      { cwd: join(__dirname, '..'), encoding: 'utf8' },
    );

    expect(out).toBe('<p>ok</p>');
  });

  it('has no ESM anywhere in its tree', () => {
    /*
      The whole reason for this library over a better-known one.
      `sanitize-html` was tried first and rejected here: its parser publishes
      ESM only, and it loads under Node 24 purely because `require(ESM)`
      happens to be supported — which is the same thin ice that broke.
    */
    const tree = treeOf('xss');

    expect(tree.length).toBeGreaterThan(1);
    expect(tree.filter((p) => p.type === 'module')).toEqual([]);
    expect(tree.filter((p) => p.type === 'missing')).toEqual([]);
  });

  it('needs no DOM, so it reads the same on the server and in the browser', () => {
    // DOMPurify against jsdom and DOMPurify against a real browser DOM are
    // not guaranteed to agree, and this text renders in both halves of the
    // same page. A parser that touches no DOM cannot disagree with itself.
    /*
      Comments stripped: the doc comment explains at length which library
      this replaced and why, so it names every one of them. Scanning the raw
      file asserts that the history is undocumented, which is the opposite of
      what is wanted.
    */
    const src = readFileSync(join(__dirname, '..', 'lib', 'wiki-html.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(src).not.toMatch(/jsdom|isomorphic-dompurify|DOMPurify/);
    expect(sanitizeWikiHtml('<p>same</p>')).toBe('<p>same</p>');
  });

  it('is not papered over by a bundler setting any more', () => {
    // `serverExternalPackages` existed only to stop Next bundling jsdom.
    const config = readFileSync(join(__dirname, '..', 'next.config.ts'), 'utf8');
    expect(config).not.toMatch(/serverExternalPackages/);
  });

  it('is gone from the manifest, not merely unused', () => {
    const pkg = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    expect(pkg).not.toMatch(/isomorphic-dompurify/);
    expect(pkg).toMatch(/"xss"/);
  });
});
