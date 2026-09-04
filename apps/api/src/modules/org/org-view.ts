import { Prisma } from '@prisma/client';

/**
 * What `/orgs/by-slug/:slug` publishes to anyone who asks (SEC-11).
 *
 * The endpoint is unauthenticated by design — a co-op's public page, its join
 * page and its public event listings all have to render for a stranger — and
 * it was returning the entire `Organization` row: the connected Stripe account
 * id, the plan customer and subscription ids, the billing waiver and the
 * free-text reason for it, suspension notes, the revenue share, and the whole
 * `settings` blob. **Confirmed live on production before this existed.**
 *
 * Same argument as `PUBLIC_TIER_SELECT` (MEM-14), and the same shape of fix: a
 * select rather than a delete-list, because a column added to the model
 * tomorrow is absent from a select and present in a redaction somebody forgot
 * to update. The two differ in what they are protecting — tiers leaked price
 * ids, this leaks a co-op's commercial relationship with MaybeOS, some of it
 * written by MaybeOS staff about them.
 *
 * Everything here is needed by a consumer:
 *   - identity and branding for the header and the public page;
 *   - `allowPublicJoin`, which decides whether a Join button exists;
 *   - `plan`, `ticketFeeCents` and `stripeChargesEnabled`, which decide what a
 *     ticket costs and whether it can be bought — the portal's event pages are
 *     public, so these have to be too.
 */
export const PUBLIC_ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  mission: true,
  logoUrl: true,
  brandColor: true,
  allowPublicJoin: true,
  plan: true,
  ticketFeeCents: true,
  stripeChargesEnabled: true,
} satisfies Prisma.OrganizationSelect;
