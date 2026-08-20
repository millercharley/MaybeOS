import {
  STARTER_QUESTIONS,
  STARTER_INSTRUMENT_VERSION,
  windowLabelFor,
} from '../starter-instrument';

/**
 * The questions MaybeOS ships with (IMP-18).
 *
 * These are put to real members of a real co-op, a handful of times a year,
 * and a mistake here is not a rendering bug — it is a year of answers that
 * cannot be aggregated. So the shape is pinned rather than trusted.
 */
describe('the starter instrument', () => {
  it('covers all four touchpoints', () => {
    // A touchpoint with no question renders nothing forever, silently: the
    // ask endpoint returns null and looks exactly like a spent budget.
    const covered = new Set(STARTER_QUESTIONS.map((q) => q.touchpoint));

    expect([...covered].sort()).toEqual(['BOOKING', 'COMMONS', 'POST_EVENT', 'TICKET_PURCHASE']);
  });

  it('gives every question a stable key, and no duplicates', () => {
    // `key` is what a question keeps across versions and across co-ops. Two
    // questions sharing one would collide on (surveyId, key, version).
    const keys = STARTER_QUESTIONS.map((q) => q.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^[a-z][a-z0-9_]*$/.test(k))).toBe(true);
  });

  it('anchors every scale at both ends', () => {
    // A 1–5 with no labels is five buttons. The answers only mean the same
    // thing across members if everybody read the ends the same way.
    for (const q of STARTER_QUESTIONS) {
      expect(q.anchorLow?.length).toBeGreaterThan(0);
      expect(q.anchorHigh?.length).toBeGreaterThan(0);
    }
  });

  it('records direction wherever a high score is bad news', () => {
    const loneliness = STARTER_QUESTIONS.find((q) => q.category === 'loneliness');

    // Belonging and loneliness are both 1–5 and point opposite ways. A report
    // that averaged a category without this would print "loneliness 4.2"
    // beside "belonging 4.2" and read them as the same result.
    expect(loneliness?.higherIsBetter).toBe(false);
    for (const q of STARTER_QUESTIONS.filter((x) => x.category !== 'loneliness')) {
      expect(q.higherIsBetter ?? true).toBe(true);
    }
  });

  it('only asks types the ask component can render', () => {
    // TEXT and CHOICE-without-options have nothing to tap, and the component
    // returns null rather than showing a dead end — which would be a
    // touchpoint that silently never collects.
    for (const q of STARTER_QUESTIONS) {
      expect(['SCALE', 'NUMBER']).toContain(q.type);
    }
  });

  it('gives every question a category the dashboard aggregates', () => {
    const headline = ['belonging', 'loneliness', 'network_size', 'participation', 'civic_engagement'];

    for (const q of STARTER_QUESTIONS) {
      expect(headline).toContain(q.category);
    }
  });

  it('names the window after the year it opened', () => {
    expect(windowLabelFor(new Date('2026-03-04T00:00:00Z'))).toBe('2026 baseline');
  });

  it('starts at version 1', () => {
    expect(STARTER_INSTRUMENT_VERSION).toBe(1);
  });
});
