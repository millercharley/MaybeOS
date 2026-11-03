/**
 * Where a list of past events is allowed to live (EVT-49).
 *
 * Charley: "Always provide a second tab on any screen where previous events
 * are listed so that previous events all live together and are searchable,
 * not listed with upcoming events. … Run a sweep of every page a member or an
 * admin might use where events are listed to comply with this rule."
 *
 * The sweep found three screens and fixed them. This is what stops the fourth:
 * **always** is a rule, and a rule nothing checks is a rule that lasts until
 * the next page. All three had arrived at the same shape independently — a
 * "Past" section stacked under a "Coming up" one — which is what a convention
 * does when it is only written in prose.
 *
 * Two rules, which together say "you cannot list past events without tabs":
 *
 *   1. Nobody rolls their own split. `splitEvents` is the one place that
 *      decides what past means, and it measures from the end so an evening in
 *      progress is not filed under history.
 *   2. Anything that calls `splitEvents` renders `EventTabs`. Having both
 *      lists and showing them stacked is precisely the thing being banned.
 *
 * **This scan strips comments first**, unlike the API's address scan, which
 * reads them on purpose. The opposite reason applies here: these files
 * explain the rule they keep — `my-rsvps.tsx` quotes the exact filter it used
 * to have — and a scan matching its own prose would fail on the fix.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { stripComments } from './source-scan';

export const WEB = join(__dirname, '..', '..');

/**
 * Deriving upcoming-and-past by hand.
 *
 * Each of these is a real line that was in this repo. A filter that keeps
 * only what is ahead — `!e.isPast` — is not here and is fine: a screen that
 * lists no past events needs no tab for them.
 */
export const HAND_ROLLED = [
  {
    pattern: /=>\s*[A-Za-z_$][\w$]*\.isPast\b/,
    why: 'builds its own list of past events; use splitEvents from lib/event-tabs',
  },
  {
    pattern: /\.isPast\s*\|\|/,
    why: 'treats cancelled as past; splitEvents separates by time only',
  },
  {
    pattern: /new Date\([^)]*\.startTime\)\s*<\s*now\b/,
    why: 'calls an event past once it has started; splitEvents measures from the end',
  },
];

/**
 * Files that may break those rules, and why.
 *
 * Exact paths, never prefixes. An exemption covering a directory quietly
 * covers every file added to it later, which is how the first version of the
 * API's address guard escaped a mutation.
 */
export const EXEMPT = [
  // The rule itself has to be written somewhere.
  'lib/event-tabs.ts',
];

const SKIP_DIRECTORIES = ['node_modules', '.next', 'coverage', '__tests__'];
const EXTENSIONS = ['.ts', '.tsx'];

/** Every page and component a member or an admin can reach. */
export function screenFiles(): string[] {
  const out: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.includes(entry.name)) walk(join(directory, entry.name));
      } else if (EXTENSIONS.includes(extname(entry.name))) {
        out.push(relative(WEB, join(directory, entry.name)));
      }
    }
  };

  for (const root of ['app', 'components', 'lib']) walk(join(WEB, root));

  return out.sort();
}

export interface Offence {
  file: string;
  why: string;
}

/** What is wrong with one file's source, if anything. */
export function offencesIn(file: string, source: string): Offence[] {
  if (EXEMPT.includes(file)) return [];

  const code = stripComments(source);
  const found: Offence[] = [];

  for (const { pattern, why } of HAND_ROLLED) {
    if (pattern.test(code)) found.push({ file, why });
  }

  // Having both lists and no tabs is the stacked "Past" section itself.
  if (/\bsplitEvents\s*\(/.test(code) && !/\bEventTabs\b/.test(code)) {
    found.push({
      file,
      why: 'splits events into upcoming and past without rendering EventTabs',
    });
  }

  return found;
}

/** Every offence across every screen. */
export function sweep(): Offence[] {
  return screenFiles().flatMap((file) =>
    offencesIn(file, readFileSync(join(WEB, file), 'utf8')),
  );
}
