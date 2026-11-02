/**
 * Reading source as text, for the tests that scan it (OPS-40).
 *
 * A lot of rules here are held by reading a file and asserting on what is in
 * it — that a route is guarded, that a timer passes `background: true`, that
 * a sanitiser is not bypassed. Those tests all have to ignore comments,
 * because every one of these files explains the rule it keeps, and a scan
 * that matches its own prose proves nothing.
 *
 * Each of them grew its own stripper, and between them they got it wrong in
 * three ways, all of which cost real debugging:
 *
 *   - `//[^\n]*` matches the `//` inside `https://example.com`, truncating
 *     the line. An assertion about `window.location.origin` failed on a rule
 *     the code kept, because the origin sat after a URL on the same line.
 *   - Stripping block comments first finds the `/**` inside a line comment
 *     mentioning `chunks/app/**` and treats it as an opener, blanking
 *     everything down to the next close. One file lost forty lines that way,
 *     including the `silent: false` the test was looking for.
 *   - Dropping comments without their newlines moves every line number after
 *     them, so a failure points at the wrong place.
 *
 * None of those are fixable by a better regex, because deciding whether `//`
 * starts a comment means knowing whether you are inside a string. So this
 * walks the text instead. It is about thirty lines and it is correct, which
 * is a better trade than a clever pattern nobody can read.
 *
 * Comments are blanked rather than removed: the text keeps its length and
 * its newlines, so offsets and line numbers still line up with the file on
 * disk.
 */
export function stripComments(source: string): string {
  const out = source.split('');
  let i = 0;

  const blank = (from: number, to: number) => {
    for (let j = from; j < to && j < out.length; j += 1) {
      if (out[j] !== '\n') out[j] = ' ';
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    // A string, which is the whole reason this is not a regex: `//` and `/*`
    // inside one are text, not comments.
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) {
        // A backslash escapes the next character, including the quote.
        i += source[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }

    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/** A source file with its comments blanked, ready to assert against. */
export function readSource(...pathParts: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  return stripComments(readFileSync(join(...pathParts), 'utf8'));
}
