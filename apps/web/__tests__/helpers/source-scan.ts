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
 *
 * **A fourth way it was wrong, found 2026-11-14: regex literals.** A quote
 * inside one — `replace(/["<>]/g, '')` in `rich-composer.tsx` — was read as
 * the start of a string, and the walk then skipped to the next `"` hundreds
 * of lines away, blanking nothing in between. Every comment after it survived
 * stripping, so a guard scanning that file could match the file's own prose
 * instead of its code from that point on. `composer-links` and
 * `handbook-images` both scan it.
 *
 * That is the same failure as the other three and the same failure as the
 * route audit: not a wrong answer, an unasked question. A scanner blind to
 * part of a file reports clean on it.
 *
 * Telling a regex literal from division needs the previous token, because `/`
 * is both. The rule below is deliberately conservative — a literal it fails
 * to recognise is treated as division, which is exactly today's behaviour, so
 * the worst case of being wrong is being no worse. `<` is kept out of the set
 * on purpose: `</div>` would otherwise start a "regex" and eat the JSX.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Characters after which a `/` opens a regex rather than dividing.
 *
 * An operator or an opening bracket cannot be followed by division, so a `/`
 * there is a literal. A letter, digit, `)` or `]` ends an expression, so a `/`
 * there is division. Covers every literal in this codebase: `replace(/…/)`,
 * `const re = /…/`, `!/…/.test(x)`, `? /…/ :`, `&& /…/`.
 */
const BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '{']);

export function stripComments(source: string): string {
  const out = source.split('');
  let i = 0;
  /**
   * The last two characters that were code, so `/` can be read in context.
   *
   * Two rather than one only because of `=>`: whitespace is skipped, so the
   * `>` of an arrow and the `>` that closes a JSX tag look identical from one
   * character away. `<div>/admin</div>` must not open a regex.
   */
  let previous = '';
  let beforePrevious = '';

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
      beforePrevious = previous;
      previous = c;
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

    /*
      A regex literal. Skipped whole, so a quote inside one cannot be mistaken
      for the start of a string — the bug that made this file blind to
      everything after `replace(/["<>]/g, '')`.

      `[` has to be tracked: inside a character class `/` is an ordinary
      character and does not end the literal, which is what `/[^/]+/` relies
      on. `\` escapes the next character anywhere.
    */
    const afterArrow = beforePrevious === '=' && previous === '>';
    if (c === '/' && (previous === '' || BEFORE_REGEX.has(previous) || afterArrow)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const d = source[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;            // Unterminated: not a literal after all.
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j += 1; break; }
        j += 1;
      }
      // Only accept it if it actually closed on this line; otherwise fall
      // through and treat the `/` as the ordinary character it must be.
      if (j <= source.length && source[j - 1] === '/') {
        i = j;
        beforePrevious = previous;
        previous = '/';
        continue;
      }
    }

    if (!/\s/.test(c)) {
      beforePrevious = previous;
      previous = c;
    }
    i += 1;
  }

  return out.join('');
}

/** A source file with its comments blanked, ready to assert against. */
export function readSource(...pathParts: string[]): string {
  return stripComments(readFileSync(join(...pathParts), 'utf8'));
}
