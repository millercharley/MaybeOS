import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The embed's times, and what lies past the window (EVT-54).
 *
 * Charley, looking at maybeitsfate.com/events:
 *   1. "Show the start and ending time for each in this format: 5:30pm to
 *      7:30pm"
 *   2. "Show every event in the next 30 days, not just the next 10 upcoming
 *      events. Offer a button that reads 'See More' to reveal the next 15
 *      events."
 *
 * The second had a false premise worth recording. Nothing was capped at ten:
 * the feed has always been the whole 30-day window, and the script has always
 * rendered all of it. MaybeItsFate simply *has* ten public events in the next
 * 30 days — nine more in that window are members-only, which a public embed
 * must not show. So "See More" reaches past the window rather than further
 * into it.
 */
const RAW = readFileSync(join(__dirname, '..', 'public', 'embed.js'), 'utf8');

// Comments stripped: this file's prose names every rule it checks, and the
// embed's prose now quotes the format it produces.
const SOURCE = stripComments(RAW);

/**
 * The real `when`, lifted out of the file and run.
 *
 * `embed.js` is a browser IIFE that exports nothing, so the rest of this repo
 * tests it by reading it. A date formatter is the wrong thing to test that
 * way — the bug would be in what it *prints*, which a scan cannot see — so
 * the three helpers are sliced out by name and evaluated. That keeps this
 * honest: it runs the shipped code, and it breaks if the helper is renamed
 * out from under it.
 */
const when: (start: string, end?: string | null) => string = (() => {
  const from = RAW.indexOf('  var day = function (d) {');
  const to = RAW.indexOf('  // textContent throughout');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${RAW.slice(from, to)}; return when;`)();
})();

describe('the time a visitor reads', () => {
  // Fixed so the expectations are about the formatter, not about where the
  // machine running them happens to be.
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('prints the exact format asked for', () => {
    // The Louisville TimeBank potluck, which is the row in Charley's
    // screenshot: it read "Sun, Nov 1 · 5:30 PM" and no end at all.
    expect(when('2026-11-01T22:30:00.000Z', '2026-11-02T00:30:00.000Z')).toBe(
      'Sun, Nov 1 · 5:30pm to 7:30pm',
    );
  });

  it('closes up the meridiem and lowercases it', () => {
    const out = when('2026-11-01T21:30:00.000Z', '2026-11-02T00:30:00.000Z');
    expect(out).toContain('4:30pm');
    expect(out).not.toMatch(/\s(?:PM|AM|pm|am)/);
    expect(out).not.toContain('P.M.');
  });

  it('separates the two with the word "to"', () => {
    expect(when('2026-11-01T22:30:00.000Z', '2026-11-02T00:30:00.000Z')).toContain(' to ');
  });

  it('keeps the start alone when there is no end', () => {
    expect(when('2026-11-01T22:30:00.000Z')).toBe('Sun, Nov 1 · 5:30pm');
    expect(when('2026-11-01T22:30:00.000Z', null)).toBe('Sun, Nov 1 · 5:30pm');
  });

  /*
    The three that would print nonsense rather than fail loudly, which is why
    they are each pinned. A range is only a range when both ends are real and
    in the right order.
  */
  it('does not print a range that runs backwards', () => {
    expect(when('2026-11-01T22:30:00.000Z', '2026-11-01T18:00:00.000Z')).toBe(
      'Sun, Nov 1 · 5:30pm',
    );
  });

  it('does not print a zero-length range', () => {
    expect(when('2026-11-01T22:30:00.000Z', '2026-11-01T22:30:00.000Z')).toBe(
      'Sun, Nov 1 · 5:30pm',
    );
  });

  it('ignores an end it cannot read', () => {
    expect(when('2026-11-01T22:30:00.000Z', 'not a date')).toBe('Sun, Nov 1 · 5:30pm');
  });

  it('repeats the date when the event runs past midnight', () => {
    // Otherwise a 10pm–1am event reads as though it ended three hours before
    // it started.
    expect(when('2026-11-21T03:00:00.000Z', '2026-11-21T06:00:00.000Z')).toBe(
      'Fri, Nov 20 · 10:00pm to Sat, Nov 21 · 1:00am',
    );
  });

  it('says nothing at all for an unreadable start', () => {
    expect(when('nonsense', '2026-11-01T22:30:00.000Z')).toBe('');
  });

  it('leaves a 24-hour locale alone', () => {
    /*
      The regex only strips a meridiem when there is one. A visitor whose
      browser is set to 24-hour time set that deliberately, and forcing
      hour12 to get a lowercase "pm" would override it.
    */
    const out = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }).format(new Date('2026-11-01T22:30:00.000Z'));
    expect(out).toBe('17:30');
    expect(out).not.toMatch(/m$/);
  });

  it('is what both the hero and the rows call', () => {
    // One formatter, not two that drift. Both pass the end time.
    const calls = SOURCE.match(/when\(event\.startTime, event\.endTime\)/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(SOURCE).not.toMatch(/when\(event\.startTime\)/);
  });
});

describe('See More', () => {
  it('renders the whole window before offering anything else', () => {
    // The window was never the thing truncating that page, and a cap added
    // here would be the bug Charley thought he was reporting.
    expect(SOURCE).toContain('events.slice(1).forEach');
    expect(SOURCE).not.toMatch(/events\.slice\(1,\s*\d+\)/);
  });

  it('reads the extra events from their own key', () => {
    expect(SOURCE).toMatch(/var more = data\.more \|\| \[\];/);
  });

  it('says exactly "See More"', () => {
    expect(SOURCE).toContain("expand.textContent = 'See More';");
  });

  it('draws no button when there is nothing behind it', () => {
    expect(SOURCE).toMatch(/if \(!more\.length\) return;/);
  });

  it('reveals them without going back to the network', () => {
    // They arrived with the first response; a button that fetches is a
    // button that can fail on somebody else's website.
    const handler = SOURCE.slice(SOURCE.indexOf("expand.addEventListener('click'"));
    expect(handler.slice(0, 500)).not.toContain('fetch');
    expect(handler).toMatch(/more\.forEach/);
  });

  it('keeps itself at the bottom of the list', () => {
    expect(SOURCE).toMatch(/wrap\.insertBefore\(line\(event\), expand\)/);
  });

  it('goes away once it has been used', () => {
    expect(SOURCE).toMatch(/expand\.remove\(\)/);
  });

  it('builds the rows the same way the window does', () => {
    // `line`, not a second renderer: an event three weeks further out is not
    // a different kind of thing.
    const handler = SOURCE.slice(SOURCE.indexOf("expand.addEventListener('click'"));
    expect(handler).toContain('line(event)');
  });
});
