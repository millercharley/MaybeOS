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
export function rankMatches<T extends CandidateEvent>(
  events: readonly T[],
  standings: readonly InterestStanding[],
  limit: number,
): ScoredEvent<T>[] {
  const weights = interestWeights(standings);
  if (weights.size === 0 || limit <= 0) return [];

  return events
    .map((event) => scoreEvent(event, weights))
    .filter((scored) => scored.score >= MATCH_THRESHOLD && scored.matched.length > 0)
    .sort(
      (a, b) => b.score - a.score || a.event.startTime.getTime() - b.event.startTime.getTime(),
    )
    .slice(0, limit);
}
