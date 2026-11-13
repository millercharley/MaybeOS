import {
  checklistIsWorthShowing,
  stepsStillToDo,
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
