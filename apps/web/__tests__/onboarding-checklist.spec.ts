import {
  checklistIsWorthShowing,
  stepsStillToDo,
  welcomeIsDue,
  type ChecklistCounts,
} from '@/lib/onboarding-checklist';

const counts = (over: Partial<ChecklistCounts> = {}): ChecklistCounts => ({
  completed: 2,
  total: 5,
  allDone: false,
  ...over,
});

/**
 * The checklist moved from a pinned panel into a nav row that opens when
 * asked (ONB-02). The rule that came with the move — a finished checklist
 * stops existing — is the one worth holding: get it wrong and every member
 * who ever completed onboarding has a dead row in their navigation for good.
 */
describe('whether the row is there at all', () => {
  it('is, while there is something left to do', () => {
    expect(checklistIsWorthShowing(counts())).toBe(true);
  });

  it('is not, once everything is done', () => {
    // Charley, 2026-11-13: "This widget disappears as an option after all
    // items are completed." No congratulation and nothing to dismiss.
    expect(checklistIsWorthShowing(counts({ completed: 5, allDone: true }))).toBe(false);
  });

  it('believes the server over the arithmetic', () => {
    // `allDone` is the server's verdict and the counts are two separate
    // tallies. When they disagree, the verdict wins — a checklist the API
    // considers finished must not be resurrected by a stale count.
    expect(checklistIsWorthShowing(counts({ completed: 2, total: 5, allDone: true }))).toBe(
      false,
    );
  });

  it('is not, for a co-op that switched the checklist on and wrote no steps', () => {
    // A row called "Getting started" that opens onto an empty list reads as
    // broken rather than as empty.
    expect(checklistIsWorthShowing(counts({ completed: 0, total: 0 }))).toBe(false);
  });

  it('is not, before the first answer has arrived', () => {
    // Nothing is drawn until the state is in, or the nav jumps a beat after
    // it paints.
    expect(checklistIsWorthShowing(null)).toBe(false);
  });
});

describe('the number on the badge', () => {
  it('counts what is left, not what is done', () => {
    expect(stepsStillToDo(counts({ completed: 2, total: 5 }))).toBe(3);
    expect(stepsStillToDo(counts({ completed: 4, total: 5 }))).toBe(1);
  });

  it('never goes below zero, whatever the two tallies say', () => {
    // A step removed from a co-op's configuration after a member had already
    // ticked it leaves `completed` the larger of the two for a moment. A
    // negative number in a red pill is a bug report from a member.
    expect(stepsStillToDo(counts({ completed: 6, total: 5 }))).toBe(0);
  });
});

describe('the welcome-in acknowledgement', () => {
  it('is due once the last box is ticked', () => {
    expect(welcomeIsDue(counts({ completed: 5, allDone: true }))).toBe(true);
  });

  it('is not due while there is work left', () => {
    expect(welcomeIsDue(counts())).toBe(false);
  });

  it('is not due for a co-op with no checklist, or a member who has read it', () => {
    // Both arrive as null: the API answers null once `onboardingDismissedAt`
    // is set, which is what keeps this to once per member for good without a
    // second flag anywhere to fall out of step.
    expect(welcomeIsDue(null)).toBe(false);
  });

  it('is never due at the same time as the row', () => {
    // The two are complements, not two opinions. A state that showed both
    // would put a checklist in the nav and a congratulation on the dashboard
    // on the same screen.
    const states: Array<ChecklistCounts | null> = [
      null,
      counts({ completed: 0, total: 0 }),
      counts({ completed: 0, total: 5 }),
      counts({ completed: 4, total: 5 }),
      counts({ completed: 5, total: 5, allDone: true }),
      counts({ completed: 6, total: 5, allDone: true }),
      counts({ completed: 0, total: 0, allDone: true }),
    ];

    for (const state of states) {
      expect(checklistIsWorthShowing(state) && welcomeIsDue(state)).toBe(false);
    }
  });
});
