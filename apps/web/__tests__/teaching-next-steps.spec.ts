import {
  DATE_PROBLEMS,
  dateRowProblem,
  datesWaiting,
  stepsAfterPublish,
  type PublishedShape,
} from '@/lib/teaching';
import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const session = (over: Partial<{ isPublished: boolean; location: { name: string } | null }> = {}) => ({
  isPublished: true,
  location: null,
  ...over,
});

const offering = (over: Partial<PublishedShape> = {}): PublishedShape => ({
  visibility: 'MEMBERS_ONLY',
  sessions: [session()],
  ...over,
});

/**
 * What a teacher is told the moment their workshop goes live (TCH-02).
 *
 * The interesting case is the one that is *not* here: there is no "add it to
 * the calendar" step, because publishing already did that. A prompt offering
 * to do something the product has done is how people stop trusting prompts.
 */
describe('what to say after publishing', () => {
  it('confirms the dates are on the calendar', () => {
    expect(stepsAfterPublish(offering())).toContain('calendar');
  });

  it('never offers to add them, because publishing did', () => {
    expect(stepsAfterPublish(offering())).not.toContain('add-to-calendar' as never);
  });

  /**
   * Charley's condition: prompt when they added dates. A workshop gathering
   * interest has nothing to be told about rooms or calendars yet.
   */
  it('says nothing at all when there are no dates', () => {
    expect(stepsAfterPublish(offering({ sessions: [] }))).toEqual([]);
    expect(stepsAfterPublish(offering({ sessions: undefined }))).toEqual([]);
  });

  it('says it for a public workshop and a members-only one alike', () => {
    for (const visibility of ['PUBLIC', 'MEMBERS_ONLY'] as const) {
      expect(stepsAfterPublish(offering({ visibility }))).toContain('calendar');
    }
  });

  /**
   * The honest case. A workshop kept off the lists has dates nobody will
   * find, and telling the teacher it is "on the calendar" would be a lie the
   * product only gets caught in later.
   */
  it('does not claim the calendar for a workshop kept off the lists', () => {
    const steps = stepsAfterPublish(offering({ visibility: 'PRIVATE' }));

    expect(steps).toContain('private');
    expect(steps).not.toContain('calendar');
  });

  it('offers a room when no date has one', () => {
    expect(stepsAfterPublish(offering())).toContain('room');
  });

  /** Already sorted. Asking again is noise. */
  it('stays quiet about rooms once every date has one', () => {
    const steps = stepsAfterPublish(
      offering({ sessions: [session({ location: { name: 'The Attic' } })] }),
    );

    expect(steps).not.toContain('room');
    expect(steps).toEqual(['calendar']);
  });

  it('still offers a room when only some dates have one', () => {
    const steps = stepsAfterPublish(
      offering({ sessions: [session({ location: { name: 'The Attic' } }), session()] }),
    );

    expect(steps).toContain('room');
  });

  /**
   * A date held back because the co-op requires a room is the one thing
   * between that evening and the calendar, so it replaces the optional nudge
   * rather than sitting beside it.
   */
  it('leads with the dates that cannot go up without a room', () => {
    const steps = stepsAfterPublish(
      offering({ sessions: [session({ isPublished: false }), session()] }),
    );

    expect(steps).toEqual(['calendar', 'needs-room']);
    expect(steps).not.toContain('room');
  });

  it('counts the dates still waiting', () => {
    expect(
      datesWaiting(offering({ sessions: [session({ isPublished: false }), session()] })),
    ).toBe(1);
    expect(datesWaiting(offering())).toBe(0);
  });

  /**
   * A session from a read that does not carry `isPublished` must not be
   * counted as waiting — undefined is "not told", not "no".
   */
  it('does not call a date unpublished just because nobody said', () => {
    expect(datesWaiting(offering({ sessions: [{ location: null }] }))).toBe(0);
  });
});

/**
 * The client's copy of the date rules must say what the server's says
 * (TCH-02).
 *
 * The API is the authority and does not import `@maybeos/shared`, so the
 * rule lives twice. Two copies drift; this reads the real API file and fails
 * when they do. It is the same trick the unauthenticated-route audit uses,
 * and it is cheaper than a shared package the API build would have to learn
 * to bundle.
 */
describe('the client’s copy of the date rules', () => {
  const apiSource = () =>
    stripComments(
      readFileSync(
        join(__dirname, '..', '..', 'api', 'src', 'modules', 'teaching', 'offering-control.ts'),
        'utf8',
      ),
    );

  it('uses the same words the server does', () => {
    const source = apiSource();

    for (const message of Object.values(DATE_PROBLEMS)) {
      expect(source).toContain(message);
    }
  });

  /** If the server grows a rule, this list is the reminder to grow too. */
  it('knows how many rules the server has', () => {
    const returns = apiSource().match(/return '[^']+';/g) ?? [];
    const inDraftCheck = returns.filter((line) =>
      Object.values(DATE_PROBLEMS).some((m) => line.includes(m)),
    );

    expect(inDraftCheck).toHaveLength(Object.keys(DATE_PROBLEMS).length);
  });

  it('agrees with the server about an ordinary date', () => {
    expect(
      dateRowProblem({
        title: 'Week one',
        startTime: '2026-12-01T18:00',
        endTime: '2026-12-01T20:00',
      }),
    ).toBeNull();
  });

  it('catches the mistake it exists for, before the server has to', () => {
    expect(
      dateRowProblem({
        title: 'Week one',
        startTime: '2026-12-01T20:00',
        endTime: '2026-12-01T18:00',
      }),
    ).toBe(DATE_PROBLEMS.backwards);
  });

  it('treats an empty date box as unreadable rather than as now', () => {
    expect(
      dateRowProblem({ title: 'Week one', startTime: '', endTime: '' }),
    ).toBe(DATE_PROBLEMS.unreadable);
  });
});

/**
 * A private lesson has no dates and cannot be given any — `mayHaveSessions`
 * says so and the API refuses them (TCH-01). So the one line it gets after
 * publishing must not send the teacher looking for a button that is not
 * there, and deliberately is not there.
 *
 * Found by publishing one and reading what it said.
 */
describe('a private lesson, after publishing', () => {
  it('has no date steps at all', () => {
    expect(stepsAfterPublish({ visibility: 'MEMBERS_ONLY', sessions: [] })).toEqual([]);
  });

  it('never tells a lesson teacher to add dates', () => {
    const source = stripComments(
      readFileSync(join(__dirname, '..', 'components', 'teaching', 'after-save.tsx'), 'utf8'),
    );

    // The add-dates line must be reachable only when it is not a lesson.
    expect(source).toContain("offering.kind === 'PRIVATE_LESSON'");
    const addDates = source.indexOf('Add dates whenever you know them');
    const branch = source.indexOf("offering.kind === 'PRIVATE_LESSON'");
    expect(branch).toBeGreaterThan(-1);
    expect(addDates).toBeGreaterThan(branch);
  });
});
