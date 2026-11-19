/**
 * How many people this co-op has, answered in one place (MEM-27).
 *
 * The card said two counts disagreed. There were **five** spellings of the
 * same intent and one genuine bug:
 *
 * - `member-capacity.ts` — `COUNTED_ROLES`, the original and correct one
 * - `recap.service.ts` — imported that one
 * - `dashboard.service.ts` — its own local `MEMBER_ROLES`, same three roles
 * - `org.service.ts` and `stripe.service.ts` (twice) — the array inline
 * - `impact.service.ts`, twice — **no role filter at all**
 *
 * So a guest counted as a member in published impact reports and in the
 * denominator of every survey response rate, and nowhere else. Latent at
 * MaybeItsFate, which has no guests, and wrong from the first one added.
 *
 * The duplication is the actual defect. Four correct copies of a value are
 * four chances for a fifth to be written differently, and that is exactly
 * what happened — nobody decided guests should count in impact, somebody
 * just wrote `{ where: { orgId } }` and it read fine.
 *
 * **Guests are not members.** It is how Plus is billed, what the Free-plan
 * limit measures, and what a co-op means by the word. The one judgement
 * here, made once.
 *
 * ## Two different questions
 *
 * "How many members" and "how many *active* members" are not the same, and
 * `org.service.ts` was right to ask the second for its public page: a
 * cancelled membership is a former member, and counting them inflates the
 * one number a stranger uses to judge whether a place is alive. Both are
 * named here so the difference stays deliberate rather than becoming a
 * sixth spelling.
 */

/** ADMIN, STAFF, MEMBER. Not GUEST. */
export const COUNTED_MEMBER_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

export type CountedMemberRole = (typeof COUNTED_MEMBER_ROLES)[number];

/**
 * Whether a role counts towards "how many members".
 *
 * An absent role reads as MEMBER, which is what an unspecified membership
 * has always meant here.
 */
export function countsAsMember(role: string | null | undefined): boolean {
  return (COUNTED_MEMBER_ROLES as readonly string[]).includes(role ?? 'MEMBER');
}

/**
 * The `where` for counting a co-op's members.
 *
 * Returned whole rather than exposing the array, so a call site cannot
 * accidentally ask a slightly different question — which is the entire
 * history above.
 */
export function countedMemberWhere(orgId: string) {
  return { orgId, role: { in: [...COUNTED_MEMBER_ROLES] } };
}

/**
 * The same, minus anybody whose membership is cancelled.
 *
 * For numbers shown to the public or used to bill: a former member is not
 * a member. `subscriptionStatus` is null for anyone who never had a
 * subscription, and `not: 'CANCELED'` keeps those — a co-op where nobody
 * pays still has members.
 */
export function activeMemberWhere(orgId: string) {
  return {
    ...countedMemberWhere(orgId),
    subscriptionStatus: { not: 'CANCELED' as const },
  };
}
