import { Prisma } from '@prisma/client';

/**
 * What a membership tier looks like to somebody who is not an organiser
 * (MEM-14).
 *
 * `GET /orgs/:orgId/tiers` is public and unauthenticated on purpose — a co-op's
 * join page has to render for a stranger — and it returned the whole row.
 * `stripePriceIdMonthly`, `stripePriceIdYearly` and `stripeProductId` are not
 * credentials, and a price id does surface at checkout, but publishing a
 * co-op's Stripe object graph to anyone who curls the endpoint is a detail
 * nobody chose to share. `sortOrder`, `isActive`, `orgId` and the timestamps
 * are simply nobody's business either.
 *
 * Written as a `select` rather than a delete-list because the two fail
 * differently: a field added to the model tomorrow is *absent* from a select
 * and *present* in a redaction somebody forgot to update. This is the same
 * argument as the allowlist in `portal-access.ts` — the direction a mistake
 * should fail in.
 *
 * Shared between the two public paths that return tiers — this endpoint and
 * `GET /orgs/by-slug/:slug`, which embeds them for the co-op's public page —
 * so the two cannot drift apart.
 */
export const PUBLIC_TIER_SELECT = {
  id: true,
  name: true,
  description: true,
  priceMonthly: true,
  priceYearly: true,
  isPayWhatYouCan: true,
  minPrice: true,
  benefits: true,
  maxMembers: true,
  // What the tier asks of a member in return (SRV-01). Shown before somebody
  // chooses it, which is the whole point of it being here.
  serviceMinutes: true,
  servicePeriod: true,
} satisfies Prisma.MembershipTierSelect;
