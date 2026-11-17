import {
  sessionDraftProblem,
  publishShouldCascade,
  type SessionDraft,
} from '../offering-control';

const draft = (over: Partial<SessionDraft> = {}): SessionDraft => ({
  title: 'Week one: centring',
  startTime: '2026-12-01T18:00:00.000Z',
  endTime: '2026-12-01T20:00:00.000Z',
  ...over,
});

/**
 * Dates typed while writing a workshop up (TCH-02).
 *
 * Every one of these is read *before* the offering is created, so a bad third
 * date costs nothing. That ordering is the whole reason this is a pure
 * function returning a message rather than a guard that throws mid-write.
 */
describe('a date somebody typed', () => {
  it('is happy with an ordinary one', () => {
    expect(sessionDraftProblem(draft())).toBeNull();
  });

  it('accepts a seat count, and no seat count', () => {
    expect(sessionDraftProblem(draft({ capacity: 8 }))).toBeNull();
    expect(sessionDraftProblem(draft({ capacity: null }))).toBeNull();
    expect(sessionDraftProblem(draft({ capacity: undefined }))).toBeNull();
  });

  it('says which way round the dates went', () => {
    const problem = sessionDraftProblem(
      draft({ startTime: '2026-12-01T20:00:00.000Z', endTime: '2026-12-01T18:00:00.000Z' }),
    );

    expect(problem).toBe('The finish needs to be after the start.');
  });

  /** An evening that starts and finishes at once is not an evening. */
  it('refuses a session with no length', () => {
    expect(sessionDraftProblem(draft({ endTime: draft().startTime }))).not.toBeNull();
  });

  it('asks for a name rather than inventing one', () => {
    expect(sessionDraftProblem(draft({ title: '   ' }))).toMatch(/name/i);
  });

  it('does not read nonsense as a date', () => {
    expect(sessionDraftProblem(draft({ startTime: 'next Tuesday-ish' }))).toMatch(/did not read/i);
  });

  /**
   * Zero is the dangerous one: it looks like "no limit" and behaves like a
   * locked door.
   */
  it('refuses a date nobody can get into', () => {
    expect(sessionDraftProblem(draft({ capacity: 0 }))).toMatch(/no seats/i);
    expect(sessionDraftProblem(draft({ capacity: -2 }))).toMatch(/no seats/i);
  });

  /** Never tells somebody their input was invalid (DESIGN §8). */
  it('explains rather than blames', () => {
    const problems = [
      sessionDraftProblem(draft({ title: '' })),
      sessionDraftProblem(draft({ endTime: draft().startTime })),
      sessionDraftProblem(draft({ capacity: 0 })),
    ];

    for (const problem of problems) {
      expect(problem).not.toMatch(/invalid|error|illegal|you must|failed/i);
    }
  });
});

/**
 * Whether the dates follow the offering onto the calendar (TCH-02).
 *
 * The asymmetry is deliberate and is the reason this is a named function
 * rather than `dto.isPublished === true` written at the call site.
 */
describe('whether publishing carries the dates with it', () => {
  it('publishes the dates when a draft goes live', () => {
    expect(publishShouldCascade(false, true)).toBe(true);
  });

  /**
   * The one that protects other people's plans: by the time a workshop is
   * unpublished, an evening on it may have RSVPs or sold tickets.
   */
  it('never pulls a date off the calendar', () => {
    expect(publishShouldCascade(true, false)).toBe(false);
  });

  it('does nothing when the state has not moved', () => {
    expect(publishShouldCascade(true, true)).toBe(false);
    expect(publishShouldCascade(false, false)).toBe(false);
  });
});
