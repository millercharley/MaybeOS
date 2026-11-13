/**
 * Whether the getting-started row belongs in the nav at all, and what its
 * badge says (ONB-02).
 *
 * Pure and out here rather than inline in the component, because both answers
 * are rules rather than rendering: "a finished checklist stops existing" is a
 * decision Charley made, and a decision that only exists as a condition
 * inside some JSX is one that gets quietly inverted by the next person
 * rearranging the markup around it.
 */

export interface ChecklistCounts {
  completed: number;
  total: number;
  /** The server's own verdict, which is not always `completed === total`. */
  allDone: boolean;
}

/**
 * **Finished is gone** (Charley, 2026-11-13).
 *
 * No congratulation and no "hide this" to press. A checklist with every box
 * ticked is not something a member needs to dismiss, and leaving it in the
 * nav with a full progress bar asks them to tidy up after the product.
 *
 * Also gone when there are no steps. A co-op can switch the checklist on
 * before writing anything into it, and a row called "Getting started" that
 * opens onto an empty list is worse than no row — it reads as a thing that
 * is broken rather than a thing that is empty.
 *
 * `null` is "not loaded, or this co-op does not run one", and draws nothing:
 * the nav must not jump as an answer arrives.
 */
export function checklistIsWorthShowing(state: ChecklistCounts | null): boolean {
  if (!state) return false;
  return state.total > 0 && !state.allDone;
}

/**
 * Whether to say "that's everything, welcome in" (ONB-03).
 *
 * The complement of the row, not a second opinion about it: a checklist is
 * either still work, or a moment, or gone, and exactly one of those is true
 * at a time. They are written next to each other here so the next person to
 * change one is looking at the other while they do it.
 *
 * Everything else that could switch it off is already in `state` being null
 * — the co-op runs no checklist, has no steps, or this member has read the
 * congratulation and the server has recorded it.
 */
export function welcomeIsDue(state: ChecklistCounts | null): boolean {
  return Boolean(state?.allDone);
}

/**
 * The number on the badge.
 *
 * Floored at zero rather than trusted. `completed` and `total` are counted
 * separately on the server and a step removed from a co-op's configuration
 * after a member had already ticked it has, briefly, left `completed` the
 * larger of the two. A negative number in a red pill is a bug report from a
 * member; zero is a badge that simply does not draw.
 */
export function stepsStillToDo({ completed, total }: ChecklistCounts): number {
  return Math.max(0, total - completed);
}
