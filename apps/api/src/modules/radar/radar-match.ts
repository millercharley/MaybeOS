/**
 * How Radar decides a gathering is worth mentioning (RDR-01).
 *
 * Pure functions over plain data, deliberately: the matching is the part of
 * this feature that is a judgement rather than a mechanism, and a judgement
 * should be readable and testable without a database behind it.
 *
 * Two kinds of evidence, kept apart all the way through:
 *
 *   - what a member **said** — they picked the interest, or waved it away;
 *   - what their **RSVPs suggest** — they keep turning up to this sort of thing.
 *
 * Saying beats guessing, always. A member who has said no to something is not
 * guessing, and no amount of RSVP history is allowed to talk MaybeOS back into
 * suggesting it. That is the whole reason `declared` is three-valued rather
 * than a boolean with a default.
 */

/** A member's standing on one interest, as the digest needs it. */
export interface InterestStanding {
  /** The tag's current name, which is also what events carry. */
  tagName: string;
  /** true = they picked it, false = they waved it away, null = never asked. */
  declared: boolean | null;
  /** How many times they have RSVP'd to something carrying this tag. */
  rsvpCount: number;
}

export interface CandidateEvent {
  id: string;
  startTime: Date;
  /**
   * What the host called it. Used to recognise a **run** (RDR-05) — one
   * performance happening on several nights — because nothing else in the
   * data says so. See `runKey`.
   */
  title: string;
  /** `Event.tags` — the co-op's own interest words, as the host chose them. */
  tags: string[];
}

export interface ScoredEvent<T extends CandidateEvent> {
  event: T;
  score: number;
  /** The interests that earned it — what the email can honestly say. */
  matched: string[];
  /**
   * Of those, the ones the member actually said out loud.
   *
   * Kept separate so the email can tell the truth about why it arrived. "You
   * said you're interested in Games" and "you keep turning up to things like
   * this" are different claims, and only one of them is true of an inference.
   * Telling a member they said something they never said is a small lie that
   * makes every other thing the product says about them suspect.
   */
  declaredMatches: string[];
}

/** They picked it. Worth more than any amount of inference. */
export const DECLARED_YES = 4;
/**
 * They waved it away. Equal and opposite to a yes, so an event that is both
 * something they want and something they don't comes out at zero and is not
 * sent. A "no" is not a veto over every other interest the event carries, but
 * it does cancel one.
 */
export const DECLARED_NO = -4;
/**
 * The most an inference can ever be worth: three RSVPs and further ones add
 * nothing. A member who went to nine craft nights is not nine times more
 * interested in craft than someone who went to three, and letting a count run
 * away would let one enthusiasm crowd out everything else they ever said.
 */
export const MAX_INFERRED = 3;
/**
 * One inferred RSVP is enough to be worth mentioning. The brief was "loosely
 * matches", and a threshold that demanded a declared interest would make the
 * RSVP half of the feature decorative.
 */
export const MATCH_THRESHOLD = 1;

/** What each interest is worth to this member, by the tag's name. */
export function interestWeights(standings: readonly InterestStanding[]): Map<string, number> {
  const weights = new Map<string, number>();

  for (const standing of standings) {
    const name = standing.tagName.trim();
    if (!name) continue;

    if (standing.declared === true) weights.set(name, DECLARED_YES);
    else if (standing.declared === false) weights.set(name, DECLARED_NO);
    else weights.set(name, Math.min(Math.max(standing.rsvpCount, 0), MAX_INFERRED));
  }

  return weights;
}

/**
 * Score one event, and report which interests earned it.
 *
 * Only interests scoring above zero are reported as matched: the email says
 * "because you're interested in X", and that sentence has to be true. A tag
 * that dragged the score down is not a reason the member is being told.
 */
export function scoreEvent<T extends CandidateEvent>(
  event: T,
  weights: ReadonlyMap<string, number>,
): ScoredEvent<T> {
  let score = 0;
  const matched: string[] = [];
  const declaredMatches: string[] = [];

  for (const tag of new Set(event.tags.map((t) => t.trim()).filter(Boolean))) {
    const weight = weights.get(tag);
    if (weight === undefined) continue;
    score += weight;
    if (weight > 0) matched.push(tag);
    if (weight === DECLARED_YES) declaredMatches.push(tag);
  }

  return { event, score, matched, declaredMatches };
}

/**
 * The events worth putting in one member's digest, best first.
 *
 * Ties break toward whatever is happening **sooner**, because a digest is
 * read once and the thing on Friday is the one a member can still act on.
 */
/**
 * One performance on several nights, as one thing (RDR-05).
 *
 * Charley: "avoid posting the same performance multiple times for a
 * performance that has multiple dates."
 *
 * **Matched on the title, because nothing else connects them.** The three
 * nights of *Dog Sees God* are three independent rows — `parentEventId` null,
 * `recurrence` NONE, created three minutes apart by a host working down a
 * list. MaybeOS has no notion of a run, so the digest filled a third of
 * itself with the same play three times, each with its own button.
 *
 * Normalised rather than compared raw: the same title typed twice differs by
 * a stray space or a capital often enough to matter, and the cost of missing
 * a match is the bug this exists to fix.
 *
 * **Deliberately not cleverer than this.** No fuzzy matching, no stripping of
 * dates or episode numbers from titles. Those rules are right for some
 * co-ops and wrong for others, and a wrong *merge* is worse than a missed
 * one: it hides a gathering a member would have come to behind the name of
 * one they would not. Two events a co-op gives the same name to are the same
 * thing by the only authority that matters — the person who named them.
 */
export function runKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A performance, with every night of it.
 *
 * Replaces `ScoredEvent` as what a digest is built from. A single-night
 * gathering is a run of one, so there is one shape downstream rather than two
 * and no caller has to ask which it is holding.
 */
export interface ScoredRun<T extends CandidateEvent> {
  /**
   * The night to lead with: the soonest. A member reading "Thursday" and
   * three dates underneath knows what they are being offered; leading with
   * whichever row scored highest would put Saturday at the top of a list
   * starting on Thursday.
   */
  event: T;
  /** Every night, soonest first. One entry for an ordinary gathering. */
  events: T[];
  score: number;
  matched: string[];
  declaredMatches: string[];
}

/**
 * What goes in a digest, best first, capped.
 *
 * **The cap counts runs, not nights**, which is half the fix. Scoring then
 * slicing then grouping would have let one three-night play take three of the
 * five places and then collapse into one card — a digest that mentions two
 * things and had room for four.
 */
export function rankMatches<T extends CandidateEvent>(
  events: readonly T[],
  standings: readonly InterestStanding[],
  limit: number,
): ScoredRun<T>[] {
  const weights = interestWeights(standings);
  if (weights.size === 0 || limit <= 0) return [];

  const scored = events
    .map((event) => scoreEvent(event, weights))
    .filter((scored) => scored.score >= MATCH_THRESHOLD && scored.matched.length > 0)
    .sort(
      (a, b) => b.score - a.score || a.event.startTime.getTime() - b.event.startTime.getTime(),
    );

  // Insertion order is the ranking, because `Map` keeps it: the first time a
  // title appears it is already the best-scoring and soonest of its run.
  const runs = new Map<string, ScoredRun<T>>();

  for (const match of scored) {
    const key = runKey(match.event.title);
    const run = runs.get(key);

    if (!run) {
      runs.set(key, {
        event: match.event,
        events: [match.event],
        score: match.score,
        matched: [...match.matched],
        declaredMatches: [...match.declaredMatches],
      });
      continue;
    }

    run.events.push(match.event);
    /*
      Unioned, not overwritten. Two nights of one play can carry different
      tags if the host edited one of them, and the card says *why* this
      arrived — dropping a reason because it was only on the second night
      would make that sentence quietly wrong.
    */
    run.matched = [...new Set([...run.matched, ...match.matched])];
    run.declaredMatches = [...new Set([...run.declaredMatches, ...match.declaredMatches])];
  }

  for (const run of runs.values()) {
    run.events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    // The soonest night leads, even if a later one scored higher.
    run.event = run.events[0];
  }

  return [...runs.values()].slice(0, limit);
}
