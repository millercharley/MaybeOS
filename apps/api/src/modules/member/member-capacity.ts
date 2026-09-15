import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FREE_PLAN_MEMBER_LIMIT } from '../stripe/dues-pricing';
import { FORUM_SLUG } from '../org/forum.service';

type Db = Pick<Prisma.TransactionClient, 'organization' | 'userOrg'>;

/** The roles that count as members. Guests do not, matching how Plus is billed. */
export const COUNTED_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

export function countsAsMember(role: string | null | undefined): boolean {
  return (COUNTED_ROLES as readonly string[]).includes(role ?? 'MEMBER');
}

/**
 * How many more members this co-op can take, or null for no limit
 * (PAY-09, Charley 2026-09-15: Free is capped at 100).
 *
 * The MaybeOS organisers' forum is exempt: every co-op's organisers belong to
 * it, and it is not a customer on a plan.
 */
export async function memberRoom(db: Db, orgId: string): Promise<number | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true, slug: true } });
  if (!org || org.plan !== 'FREE' || org.slug === FORUM_SLUG) return null;

  const members = await db.userOrg.count({ where: { orgId, role: { in: [...COUNTED_ROLES] } } });
  return Math.max(0, FREE_PLAN_MEMBER_LIMIT - members);
}

/**
 * Refuse adding `adding` members past the Free plan's limit.
 *
 * Worded for who is asking: somebody joining is told the community is full;
 * an organiser is told how to make room. Two joins landing at the same instant
 * at member 100 can both pass, which leaves 101; that is accepted rather than
 * serialising every join in the product.
 */
export async function assertMemberRoom(
  db: Db,
  orgId: string,
  adding: number,
  audience: 'joiner' | 'organiser',
): Promise<void> {
  if (adding <= 0) return;
  const room = await memberRoom(db, orgId);
  if (room === null || room >= adding) return;

  throw new ForbiddenException(
    audience === 'joiner'
      ? `This community is full for now. It can have up to ${FREE_PLAN_MEMBER_LIMIT} members on its current MaybeOS plan, so ask an organiser about joining.`
      : `Your community is on the Free plan, which allows up to ${FREE_PLAN_MEMBER_LIMIT} members (guests aren’t counted). Upgrade to Plus or Unlimited in Settings to add more.`,
  );
}
