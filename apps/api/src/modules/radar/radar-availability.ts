import { ForbiddenException } from '@nestjs/common';
import { MaybeOsPlan } from '@prisma/client';

/**
 * Which plans Radar is part of (RDR-01, Charley 2026-10-01).
 *
 * Shaped after `member-capacity.ts`: a plain exported function rather than a
 * guard or a decorator, so it can be called inside a transaction and read
 * where it is enforced instead of hovering above a controller.
 *
 * Radar is the first MaybeOS feature that is *absent* on Free rather than
 * merely limited there, which makes the wording matter. A co-op on Free is
 * not doing anything wrong, and the refusal says what to do rather than what
 * went wrong.
 */
export const RADAR_PLANS: readonly MaybeOsPlan[] = ['PLUS', 'UNLIMITED'] as const;

export function radarAvailable(plan: MaybeOsPlan | null | undefined): boolean {
  return plan ? RADAR_PLANS.includes(plan) : false;
}

/**
 * Refuse a Radar change on a plan that does not include it.
 *
 * Only the *switching on* is refused. Everything a co-op already has — its
 * interest list, what its members told it they care about — is left alone on
 * a downgrade: deleting a member's answers because an invoice changed would
 * be destroying their data to enforce a price. The digest simply stops.
 */
export function assertRadarAvailable(plan: MaybeOsPlan | null | undefined): void {
  if (radarAvailable(plan)) return;

  throw new ForbiddenException(
    'Radar is part of Plus and Unlimited. Upgrade in Settings to let MaybeOS match gatherings to what your members are interested in.',
  );
}
