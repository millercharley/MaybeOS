import { execFileSync } from 'node:child_process';
import { stripComments } from '../../../common/testing/source-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An event whose Google entry was deleted says so (CAL-16).
 *
 * Charley, 2026-11-18: "If an event gets cancelled in the Google Calendar,
 * after the sync, if the event was already present in MaybeOS, provide a tag
 * that the admin can see to understand this is an orphaned event that was
 * cancelled in the google calendar. The admin can hide or delete the event in
 * MaybeOS or restore the event in Google Calendar."
 *
 * A single pass through `cancelEvents` on 14 November at 01:30:46 cancelled
 * 40 future events — all of "Board Games Club" and "MaybeItsFate Community
 * Potluck", out to 2028 — because both recurring series had been deleted in
 * Google as duplicates. That was correct. What was missing is that
 * `canceledAt` is written here and by a person in MaybeOS alike, so the
 * console had forty cards it could not tell from events somebody meant to
 * call off.
 *
 * And explicitly no mail, on his instruction about these same forty: "Do not
 * tell any members."
 */
const SOURCE = stripComments(
  readFileSync(join(__dirname, '..', 'calendar-import.service.ts'), 'utf8'),
);

const cancelEvents = SOURCE.slice(
  SOURCE.indexOf('private async cancelEvents'),
  SOURCE.indexOf('private async readPage'),
);

describe('marking an event the calendar dropped', () => {
  it('writes the reason beside the cancellation', () => {
    expect(cancelEvents).toMatch(/data: \{ canceledAt: now, orphanedAt: now \}/);
  });

  it('uses one instant for both, and for the whole batch', () => {
    /*
      `const now = new Date()` rather than two calls: the two columns
      describing one event must not disagree by a millisecond, and the
      timestamp shared across the batch is what let the 40 be recognised as
      one action in the first place.
    */
    expect(cancelEvents).toMatch(/const now = new Date\(\);/);
    expect(cancelEvents).not.toMatch(/orphanedAt: new Date\(\)/);
  });

  it('still only touches events not already cancelled', () => {
    // Unchanged from CAL-12, and the reason a repeated pass does not keep
    // moving the timestamp forward.
    expect(cancelEvents).toMatch(/canceledAt: null/);
  });

  it('tells nobody', () => {
    /*
      Charley, on the forty: "Do not tell any members." The remedy he asked
      for is a tag an admin reads, not mail to people whose evening was a
      duplicate of another one. This pins the absence, because an email here
      is exactly the helpful-looking thing a later change would add.
    */
    expect(cancelEvents).not.toMatch(/email|Email|send|notify/);
  });
});

describe('an entry that comes back', () => {
  const writeEvents = SOURCE.slice(
    SOURCE.indexOf('private async writeEvents'),
    SOURCE.indexOf('private async writeBookings'),
  );
  const update = writeEvents.slice(
    writeEvents.indexOf('update: {'),
    writeEvents.indexOf('if (host.hostId)'),
  );

  it('stops being an orphan with no action in MaybeOS', () => {
    /*
      The third of the three ways out, and the only one that should need
      nothing here: put it back in Google and the next sync clears the tag.
      Cleared unconditionally beside `canceledAt` — an event present in the
      feed is not orphaned, whatever it was last time.
    */
    expect(update).toMatch(/canceledAt: null/);
    expect(update).toMatch(/orphanedAt: null/);
  });
});

describe('nothing else ever sets it', () => {
  it('is written by the importer alone', () => {
    /*
      The tag means one thing — "its Google entry is gone" — and it means it
      only because one file can write it. A second writer would make the
      badge a guess, which is the state `canceledAt` is already in and the
      reason this column exists.
    */
    const api = join(__dirname, '..', '..', '..');
    const writers = execFileSync('grep', ['-rl', 'orphanedAt', api, '--include=*.ts'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.includes('__tests__'))
      .map((file) => file.split('/').pop());

    expect(writers.sort()).toEqual(['calendar-import.service.ts']);
  });
});
