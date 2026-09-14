import { OrgRole, Prisma, SubscriptionStatus } from '@prisma/client';

/**
 * Who may open a co-op's door (DOR-01).
 *
 * Charley: "Lock out members who are cancelled according to Stripe."
 *
 * - Admins and staff always: the people who run the space do not lose the key
 *   over a billing state.
 * - Members unless their subscription is cancelled. Past due keeps access, as
 *   Stripe is still retrying the card. `NONE` keeps access too: members on $0
 *   outside Stripe are being moved into it during the migration, and until
 *   then they have no subscription to cancel.
 * - Guests never.
 *
 * Written twice, once as a function and once as a Prisma filter, because
 * the sync needs both. The spec checks that the two agree.
 */
export function hasDoorAccess(member: {
  role: OrgRole;
  subscriptionStatus: SubscriptionStatus;
}): boolean {
  if (member.role === 'ADMIN' || member.role === 'STAFF') return true;
  if (member.role === 'MEMBER') return member.subscriptionStatus !== 'CANCELED';
  return false;
}

export const DOOR_ACCESS_WHERE = {
  OR: [
    { role: { in: ['ADMIN', 'STAFF'] as OrgRole[] } },
    { role: 'MEMBER' as OrgRole, subscriptionStatus: { not: 'CANCELED' as SubscriptionStatus } },
  ],
} satisfies Prisma.UserOrgWhereInput;
