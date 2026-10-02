import { ForbiddenException } from '@nestjs/common';
import { MaybeOsPlan } from '@prisma/client';

/**
 * What a paid plan buys (D-013 for the plans themselves).
 *
 * One list, because the second feature is where this goes wrong: Radar's
 * `radar-availability.ts` and a copy of it for the recap would be two places
 * to change when a feature moves between plans, and they would disagree
 * within a release. The recap is that second feature, so the list moved here
 * rather than being duplicated.
 *
 * Shaped after `member-capacity.ts`: plain exported functions rather than a
 * guard or a decorator, so they can be called inside a transaction and read
 * where they are enforced instead of hovering above a controller.
 */
export const PAID_PLANS: readonly MaybeOsPlan[] = ['PLUS', 'UNLIMITED'] as const;

/** Features that exist on Plus and Unlimited and not on Free. */
export type PaidFeature = 'radar' | 'recap';

const WHAT_IT_DOES: Record<PaidFeature, string> = {
  radar: 'match gatherings to what your members are interested in',
  recap: 'send your members a monthly recap of what their membership paid for',
};

export function planIncludes(plan: MaybeOsPlan | null | undefined): boolean {
  return plan ? PAID_PLANS.includes(plan) : false;
}

/**
 * Refuse a change on a plan that does not include the feature.
 *
 * Only *switching something on* is ever refused. Everything a co-op already
 * has — its interest list, its members' answers, recaps already sent — is
 * left alone on a downgrade: deleting somebody's data because an invoice
 * changed would be destroying it to enforce a price.
 *
 * The wording says what to do rather than what went wrong. A co-op on Free is
 * not doing anything wrong.
 */
export function assertPlanIncludes(
  plan: MaybeOsPlan | null | undefined,
  feature: PaidFeature,
): void {
  if (planIncludes(plan)) return;

  throw new ForbiddenException(
    `That is part of Plus and Unlimited. Upgrade in Settings and MaybeOS will ${WHAT_IT_DOES[feature]}.`,
  );
}
