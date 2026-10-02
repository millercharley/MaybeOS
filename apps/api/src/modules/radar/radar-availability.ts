import { MaybeOsPlan } from '@prisma/client';
import { PAID_PLANS, assertPlanIncludes, planIncludes } from '../../common/plan-features';

/**
 * Which plans Radar is part of (RDR-01, Charley 2026-10-01).
 *
 * The list itself moved to `common/plan-features.ts` when the monthly recap
 * became the second feature sold the same way — two copies of "what Plus
 * buys" is two places to change and one of them gets missed. This file stays
 * because Radar's callers read better naming the feature than the plan, and
 * because the refusal is part of Radar's own behaviour.
 */
export const RADAR_PLANS = PAID_PLANS;

export function radarAvailable(plan: MaybeOsPlan | null | undefined): boolean {
  return planIncludes(plan);
}

/**
 * Refuse turning Radar on where the plan does not include it.
 *
 * Only the switching on is refused. A co-op's interest list and what its
 * members told it survive a downgrade untouched — the digest simply stops.
 */
export function assertRadarAvailable(plan: MaybeOsPlan | null | undefined): void {
  assertPlanIncludes(plan, 'radar');
}
