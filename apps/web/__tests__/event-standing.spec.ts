import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STANDING_LABEL,
  STANDING_TONE,
  draftsAmong,
  orphanedAmong,
  orphanedNote,
  standingOf,
} from '@/lib/event-standing';

/**
 * An event deleted in Google says so, to the admin (CAL-16).
 *
 * Charley, 2026-11-18: "If an event gets cancelled in the Google Calendar,
 * after the sync, if the event was already present in MaybeOS, provide a tag
 * that the admin can see to understand this is an orphaned event that was
 * cancelled in the google calendar. The admin can hide or delete the event in
 * MaybeOS or restore the event in Google Calendar."
 *
 * One import pass cancelled 40 future events in a single statement — all of
 * "Board Games Club" and "MaybeItsFate Community Potluck", out to 2028,
 * because both recurring series had been deleted in Google as duplicates.
 * The sync was right to follow. The console showed forty ordinary-looking
 * published cards, and the only badge it had said "Published".
 */
const live = { isPublished: true };
const draft = { isPublished: false };
const cancelled = { isPublished: true, canceledAt: '2026-11-14T01:30:46.422Z' };
const orphan = {
  isPublished: true,
  canceledAt: '2026-11-14T01:30:46.422Z',
  orphanedAt: '2026-11-14T01:30:46.422Z',
};

describe('what an event’s badge says', () => {
  it('reads an orphan as an orphan, not as cancelled', () => {
    /*
      The ordering is the whole feature. An orphan is *always* also
      cancelled, so checking `canceledAt` first would mean the tag Charley
      asked for never once appeared.
    */
    expect(standingOf(orphan)).toBe('orphaned');
    expect(STANDING_LABEL[standingOf(orphan)]).toBe('Deleted in Google');
  });

  it('still tells a local cancellation apart', () => {
    // Called off here. Nothing to do about it, and nothing to suggest.
    expect(standingOf(cancelled)).toBe('cancelled');
  });

  it('keeps the two states the card already had', () => {
    expect(standingOf(live)).toBe('published');
    expect(standingOf(draft)).toBe('draft');
  });

  it('is not fooled by a draft that was also deleted in Google', () => {
    expect(standingOf({ ...orphan, isPublished: false })).toBe('orphaned');
  });

  it('gives every state a tone, and keeps alarm off the housekeeping', () => {
    /*
      Amber, never red. A co-op tidying duplicates out of its own calendar is
      housekeeping; a red badge on forty cards teaches an organiser to stop
      reading badges.
    */
    for (const standing of ['orphaned', 'cancelled', 'published', 'draft'] as const) {
      expect(STANDING_TONE[standing]).toBeTruthy();
      expect(STANDING_TONE[standing]).not.toMatch(/red/);
    }
    expect(STANDING_TONE.orphaned).toMatch(/amber/);
  });
});

describe('the note above the list', () => {
  it('says nothing when there are none', () => {
    // A screen should not explain a state it is not in (DESIGN §7).
    expect(orphanedNote(0)).toBeNull();
    expect(orphanedNote(-1)).toBeNull();
  });

  it('names all three ways out, in the order he put them', () => {
    const note = orphanedNote(40) ?? '';

    expect(note).toContain('40 events');
    expect(note).toMatch(/hide or delete/i);
    expect(note).toMatch(/back in Google/i);
    // Restoring it upstream needs nothing here, which is worth saying so
    // nobody hunts for a button.
    expect(note).toMatch(/next sync will clear this/i);
  });

  it('reads properly for exactly one', () => {
    const note = orphanedNote(1) ?? '';

    expect(note).toMatch(/^One event here was/);
    expect(note).not.toMatch(/\b1 events\b/);
    expect(note).not.toMatch(/\bthem\b/);
  });

  it('counts only the orphans', () => {
    expect(orphanedAmong([live, draft, cancelled, orphan, orphan])).toBe(2);
    expect(orphanedAmong([])).toBe(0);
  });

  it('blames nobody and alarms nobody (DESIGN §8)', () => {
    const note = orphanedNote(3) ?? '';

    expect(note).not.toMatch(/error|invalid|failed|you must|unable/i);
    expect(note).not.toMatch(/orphan/i);
  });
});

describe('the console uses it', () => {
  const src = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  );

  it('does not decide the badge in the card any more', () => {
    // The ternary this replaces is why a cancelled event read as published.
    expect(src).not.toMatch(/event\.isPublished \? 'Published' : 'Draft'/);
    expect(src).toContain('STANDING_LABEL[standingOf(event)]');
    expect(src).toContain('STANDING_TONE[standingOf(event)]');
  });

  it('counts the orphans in what is on screen, not in the whole co-op', () => {
    /*
      `filtered`, so the note agrees with the cards under it. Counting every
      event in the org would announce forty leftovers on a tab showing none
      of them.
    */
    expect(src).toMatch(/orphanedNote\(orphanedAmong\(filtered\)\)/);
  });
});

/**
 * Which of these is a draft somebody is working on (EVT-63).
 *
 * The Drafts tab came back on 2026-11-19 — "Bring the Drafts tab back with
 * only upcoming" — and the question it has to answer is not the one the
 * `isPublished` column answers.
 *
 * Hiding an event unpublishes it. Forty orphaned events were hidden on
 * 18 November, which left production holding **52** upcoming unpublished
 * events against **12** real drafts. A tab keyed on the column opens on the
 * forty: a working queue made almost entirely of things nobody will ever
 * work on.
 */
describe('the drafts among a list', () => {
  const draft = { id: 'd', isPublished: false, canceledAt: null, orphanedAt: null };
  const published = { id: 'p', isPublished: true, canceledAt: null, orphanedAt: null };
  const cancelled = { id: 'c', isPublished: false, canceledAt: '2026-11-18T00:00:00Z', orphanedAt: null };
  const orphaned = {
    id: 'o',
    isPublished: false,
    canceledAt: '2026-11-18T00:00:00Z',
    orphanedAt: '2026-11-18T00:00:00Z',
  };

  it('keeps an unfinished event', () => {
    expect(draftsAmong([draft])).toEqual([draft]);
  });

  it('leaves out a published one', () => {
    expect(draftsAmong([published])).toEqual([]);
  });

  it('leaves out one deleted in Google, though it is unpublished', () => {
    // The forty. This is the assertion the tab exists for.
    expect(orphaned.isPublished).toBe(false);
    expect(draftsAmong([orphaned])).toEqual([]);
  });

  it('leaves out a cancelled one — nobody is going to finish it', () => {
    expect(draftsAmong([cancelled])).toEqual([]);
  });

  it('answers the production shape: forty hidden orphans, twelve real drafts', () => {
    const list = [
      ...Array.from({ length: 40 }, (_, i) => ({ ...orphaned, id: `o${i}` })),
      ...Array.from({ length: 12 }, (_, i) => ({ ...draft, id: `d${i}` })),
    ];

    expect(list.filter((e) => !e.isPublished)).toHaveLength(52);
    expect(draftsAmong(list)).toHaveLength(12);
  });

  it('keeps the order it was given', () => {
    const list = [{ ...draft, id: 'a' }, published, { ...draft, id: 'b' }];

    expect(draftsAmong(list).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('the console filters drafts by standing, not by the column', () => {
  const src = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  );

  it('narrows the list with draftsAmong', () => {
    expect(src).toMatch(/draftsAmong\(inWindow\)/);
  });

  it('counts the pill with draftsAmong too, so the number means the same', () => {
    expect(src).toMatch(/draft: draftsAmong\(upcoming\)\.length/);
  });

  it('no longer filters the list on isPublished anywhere', () => {
    /*
      The line this replaces — `inWindow.filter((event) => !event.isPublished)`
      — was the checkbox's, and was already wrong before the tab existed; it
      simply had no screen to be wrong on. Comments are kept here on purpose
      so the scan reads the code, and the quoted line above lives in a
      comment in the page too, which is why this matches the call shape
      rather than the words.
    */
    expect(src).not.toMatch(/filter\(\(event\) => !event\.isPublished\)/);
  });
});
