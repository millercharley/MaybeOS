/**
 * Who gets asked to be the next buddy (PRD §5.2).
 *
 * Pure, and separated from every database concern, because this is the part
 * that has to be *fair* rather than merely correct. The promise in the
 * acceptance criteria — across twenty new members in a co-op of ten, nobody
 * is asked twice until everyone has been asked once — is a property of this
 * function alone, and a property is worth testing exhaustively rather than
 * once.
 *
 * The ordering is deliberately about **load, not merit**:
 *
 * 1. **Times served**, ascending. Someone who has already hosted a new member
 *    has done the work; asking them again before asking anyone else is how a
 *    community burns out the three people who always say yes.
 * 2. **Last asked**, ascending, nulls first. Being *asked* costs something
 *    even when you decline — this is what makes "everyone before anyone
 *    twice" true, and it is why every ask is recorded whether or not it is
 *    answered.
 * 3. **Random**, to break ties without quietly favouring whoever joined
 *    first or whose name sorts early.
 */

export interface BuddyCandidate {
  memberId: string;
  timesServed: number;
  timesAsked: number;
  lastAskedAt: Date | null;
  lastServedAt: Date | null;
  /** The member's own choice, from their profile. */
  optedOut: boolean;
  /** Pairings where they are currently the buddy. */
  activePairings: number;
  /** An ask they have not yet answered — anywhere, not just here. */
  hasOutstandingInvitation: boolean;
}

export interface RotationPolicy {
  maxActivePairings: number;
  askCooldownDays: number;
  serveCooldownDays: number;
}

export interface Selection {
  candidate: BuddyCandidate | null;
  /**
   * True when the cooldowns had to be set aside to find anybody.
   *
   * Surfaced rather than hidden because it is the co-op's early warning that
   * the same few people are carrying this: a community that relaxes its
   * cooldown on every pairing does not have a rotation, it has volunteers.
   */
  relaxedCooldowns: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reasons a member cannot be asked at all, whatever the cooldowns say. */
function isEligible(c: BuddyCandidate, policy: RotationPolicy): boolean {
  if (c.optedOut) return false;
  // One outstanding ask at a time, per person. Two invitations in someone's
  // inbox for two different new members is how a willing member starts
  // ignoring them.
  if (c.hasOutstandingInvitation) return false;
  if (c.activePairings >= policy.maxActivePairings) return false;
  return true;
}

/** Whether a cooldown is currently protecting this member from being asked. */
function inCooldown(c: BuddyCandidate, policy: RotationPolicy, now: Date): boolean {
  const askedRecently =
    c.lastAskedAt !== null &&
    now.getTime() - c.lastAskedAt.getTime() < policy.askCooldownDays * DAY_MS;
  const servedRecently =
    c.lastServedAt !== null &&
    now.getTime() - c.lastServedAt.getTime() < policy.serveCooldownDays * DAY_MS;
  return askedRecently || servedRecently;
}

/**
 * Fewest served, then longest since asked, then chance.
 *
 * `lastAskedAt: null` sorts first — never having been asked is the strongest
 * claim to being asked next, and treating it as "asked at the beginning of
 * time" would be a subtly different rule that happens to agree most of the
 * time.
 */
export function rotationOrder(
  a: BuddyCandidate,
  b: BuddyCandidate,
  tiebreak: () => number,
): number {
  if (a.timesServed !== b.timesServed) return a.timesServed - b.timesServed;

  const aAsked = a.lastAskedAt?.getTime() ?? null;
  const bAsked = b.lastAskedAt?.getTime() ?? null;
  if (aAsked === null && bAsked !== null) return -1;
  if (aAsked !== null && bAsked === null) return 1;
  if (aAsked !== null && bAsked !== null && aAsked !== bAsked) return aAsked - bAsked;

  return tiebreak() - 0.5;
}

/**
 * Pick the next person to ask, or nobody.
 *
 * Cooldowns are **soft filters**: they are applied first, and set aside
 * entirely if applying them would leave nobody. A co-op of six cannot honour
 * a thirty-day cooldown and still welcome a new member every fortnight, and
 * the right answer there is to ask someone slightly sooner than ideal — not
 * to give up and hand every new member to an admin.
 */
export function selectCandidate(
  pool: BuddyCandidate[],
  policy: RotationPolicy,
  now: Date = new Date(),
  tiebreak: () => number = Math.random,
): Selection {
  const eligible = pool.filter((c) => isEligible(c, policy));
  if (eligible.length === 0) return { candidate: null, relaxedCooldowns: false };

  const rested = eligible.filter((c) => !inCooldown(c, policy, now));
  const relaxedCooldowns = rested.length === 0;
  const considered = relaxedCooldowns ? eligible : rested;

  const sorted = [...considered].sort((a, b) => rotationOrder(a, b, tiebreak));
  return { candidate: sorted[0], relaxedCooldowns };
}
