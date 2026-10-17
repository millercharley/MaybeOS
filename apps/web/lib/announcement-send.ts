/**
 * Driving a roster-sized send from the browser (CMN-21).
 *
 * The API sends what it can inside a deadline and says what is left, so
 * finishing is the caller's job: ask again until nothing remains. That loop
 * is a state machine with three ways to go wrong — stopping early, never
 * stopping, and lying about progress — so it lives here rather than inside a
 * component, where this app's harness could not reach it.
 */

export interface Pass {
  sent: number;
  total: number;
  remaining: number;
}

/**
 * The most passes one press will make.
 *
 * A guard against a server that keeps reporting work left: a loop that
 * cannot end is worse than a send that needs pressing twice. Four hundred
 * members at roughly a hundred and fifty a pass needs three; twenty is room
 * for a co-op an order of magnitude larger.
 */
export const MAX_PASSES = 20;

/** Should the caller ask again? */
export function shouldContinue(pass: Pass, passesSoFar: number): boolean {
  if (pass.remaining <= 0) return false;
  if (passesSoFar >= MAX_PASSES) return false;
  // A pass that sent nothing while claiming work remains is a pass that will
  // send nothing next time either — every member it could reach, it reached.
  return pass.sent > 0;
}

/** What to tell the organiser while it runs, and when it stops. */
export function progressLine(pass: Pass, done: boolean): string {
  if (done && pass.remaining === 0) {
    return `Sent to ${pass.total} ${pass.total === 1 ? 'member' : 'members'}.`;
  }
  if (done) {
    // Stopped with work left: honest about it rather than claiming success.
    return `Sent to ${pass.total} so far — ${pass.remaining} left. Press again to continue.`;
  }
  return `Sending… ${pass.total} of ${pass.total + pass.remaining}`;
}
