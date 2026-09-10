/**
 * Reading a co-op's existing Stripe subscriptions and working out what they
 * would mean in MaybeOS — without changing either (MIG-01).
 *
 * A co-op arriving from another platform already has live subscriptions on its
 * own Stripe account. Those subscriptions are in the right place already: the
 * account is connected (PAY-05, `read_write`), the money already lands in the
 * co-op's bank, and every member's billing date is already set. Nothing needs
 * to move. What is missing is only MaybeOS's side of the link — which member
 * is which subscription, and which price is which tier.
 *
 * Everything in this file is pure. It takes a snapshot of Stripe and a
 * snapshot of the roster and returns what *would* happen. The service next
 * door does the reading; nothing anywhere does the writing yet, because the
 * first thing to look at is whether the match is good enough to trust.
 */

/** Stripe's recurring intervals. Anything else is not a subscription price. */
export type ScanInterval = 'day' | 'week' | 'month' | 'year';

export interface ScanItem {
  priceId: string;
  /** Unexpanded during the list; resolved to a name separately, best-effort. */
  productId: string | null;
  productName: string | null;
  /** Null for metered, tiered and package prices — there is no one amount. */
  unitAmountCents: number | null;
  quantity: number;
  interval: ScanInterval | null;
  intervalCount: number;
}

export interface ScanSubscription {
  id: string;
  /** Stripe's own word, verbatim — `active`, `trialing`, `past_due`. */
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  customerId: string | null;
  email: string | null;
  name: string | null;
  items: ScanItem[];
}

/** One membership as MaybeOS currently holds it. */
export interface MemberSnapshot {
  userOrgId: string;
  /** Already normalised by the caller. */
  email: string;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  tierName: string | null;
  tierMonthlyCents: number | null;
}

export interface TierSnapshot {
  id: string;
  name: string;
  priceMonthly: number;
  isPayWhatYouCan: boolean;
}

/**
 * What linking this subscription would do to the roster.
 *
 * `conflict` is deliberately not a failure. It means a person has to decide,
 * and the whole reason this scan exists is to find out how many of those there
 * are before anybody builds the thing that writes.
 */
export type RowOutcome = 'link' | 'create' | 'already-linked' | 'conflict';

export type ConflictReason =
  /** The Stripe customer has no email, so there is nothing to match on. */
  | 'no-email'
  /** Two live subscriptions share an email. Which one is their membership? */
  | 'duplicate-email'
  /** The member is already linked to a *different* subscription. */
  | 'member-has-other-subscription';

export interface PlannedRow {
  subscriptionId: string;
  email: string | null;
  name: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  monthlyCents: number | null;
  outcome: RowOutcome;
  conflict: ConflictReason | null;
  /** The membership this would attach to, when there is one. */
  userOrgId: string | null;
}

/**
 * How many months one billing interval covers.
 *
 * Weeks and days are converted with the average length of a month rather than
 * 4 weeks or 30 days: a co-op billing weekly collects 52 times a year, not 48,
 * and an MRR that quietly under-reports by 8% is worse than no MRR at all.
 */
const MONTHS_PER_INTERVAL: Record<ScanInterval, number> = {
  month: 1,
  year: 12,
  week: 12 / 52,
  day: 12 / 365,
};

/**
 * What one subscription item is worth per month, in cents.
 *
 * Null when Stripe does not state a single amount — metered and tiered prices
 * are billed on usage, so any figure here would be invented. They are counted
 * and set aside rather than guessed at.
 */
export function itemMonthlyCents(item: ScanItem): number | null {
  if (item.unitAmountCents === null) return null;
  if (!item.interval) return null;
  if (item.intervalCount < 1) return null;

  const months = MONTHS_PER_INTERVAL[item.interval] * item.intervalCount;
  if (months <= 0) return null;

  return Math.round((item.unitAmountCents * item.quantity) / months);
}

/**
 * What a whole subscription is worth per month.
 *
 * One unpriceable item makes the whole subscription unpriceable. Summing the
 * rest would produce a number that looks complete and is not, and this figure
 * is going to be compared against Stripe's own dashboard.
 */
export function subscriptionMonthlyCents(sub: ScanSubscription): number | null {
  if (sub.items.length === 0) return null;

  let total = 0;
  for (const item of sub.items) {
    const monthly = itemMonthlyCents(item);
    if (monthly === null) return null;
    total += monthly;
  }
  return total;
}

/**
 * Lowercase and trim, and nothing else.
 *
 * Deliberately not clever: no stripping of Gmail dots, no collapsing of `+`
 * aliases. Those rules are true of some providers and false of others, and a
 * wrong merge here joins two people's memberships together — which is worse in
 * kind than leaving a row for an admin to look at.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Statuses that mean money is currently being collected. */
const EARNING_STATUSES = ['active', 'trialing'];

/**
 * Which tier a price looks like, by amount.
 *
 * Only an exact match on an active fixed-price tier, and only when exactly one
 * tier has that price. Two tiers at $10 is an ambiguity the admin has to
 * resolve, and pay-what-you-can tiers have no single amount to match on.
 */
export function suggestTier(
  monthlyCents: number | null,
  tiers: TierSnapshot[],
): TierSnapshot | null {
  if (monthlyCents === null) return null;

  const matches = tiers.filter(
    (tier) => !tier.isPayWhatYouCan && tier.priceMonthly === monthlyCents,
  );
  return matches.length === 1 ? matches[0] : null;
}

export interface PriceGroup {
  priceId: string;
  productName: string | null;
  unitAmountCents: number | null;
  interval: ScanInterval | null;
  intervalCount: number;
  /** Per-unit monthly value, for comparing against a tier's price. */
  monthlyCents: number | null;
  subscriptions: number;
  suggestedTierId: string | null;
  suggestedTierName: string | null;
}

/**
 * Every distinct price in use, with how many subscriptions sit on it.
 *
 * This is the screen only the admin can fill in. A tier can legitimately span
 * several prices — `repriceTier` keeps retired Prices alive on purpose so
 * grandfathered members keep billing correctly — so this groups by price and
 * lets each one point at a tier, rather than assuming one price per tier.
 */
export function groupPrices(
  subs: ScanSubscription[],
  tiers: TierSnapshot[],
): PriceGroup[] {
  const groups = new Map<string, PriceGroup>();

  for (const sub of subs) {
    for (const item of sub.items) {
      const existing = groups.get(item.priceId);
      if (existing) {
        existing.subscriptions++;
        continue;
      }

      // Quantity is deliberately forced to 1 here: this is the price's own
      // monthly value, which is what gets compared against a tier. A member
      // billed for two seats does not belong to a tier costing twice as much.
      const monthlyCents = itemMonthlyCents({ ...item, quantity: 1 });
      const suggested = suggestTier(monthlyCents, tiers);

      groups.set(item.priceId, {
        priceId: item.priceId,
        productName: item.productName,
        unitAmountCents: item.unitAmountCents,
        interval: item.interval,
        intervalCount: item.intervalCount,
        monthlyCents,
        subscriptions: 1,
        suggestedTierId: suggested?.id ?? null,
        suggestedTierName: suggested?.name ?? null,
      });
    }
  }

  // Biggest cohorts first: that is the order an admin wants to map them in.
  return [...groups.values()].sort((a, b) => b.subscriptions - a.subscriptions);
}

/**
 * What linking each scanned subscription would do.
 *
 * Matched on email alone. That is the only field both systems are certain to
 * share, and it is the field the co-op's members actually log in with.
 */
export function planRows(
  subs: ScanSubscription[],
  members: MemberSnapshot[],
): PlannedRow[] {
  const byEmail = new Map(members.map((m) => [m.email, m]));

  // An email carrying two live subscriptions cannot be resolved by a rule —
  // it is a member who double-subscribed, or two people sharing an inbox, and
  // those need opposite fixes.
  const seen = new Map<string, number>();
  for (const sub of subs) {
    const email = normalizeEmail(sub.email);
    if (email) seen.set(email, (seen.get(email) ?? 0) + 1);
  }

  return subs.map((sub) => {
    const email = normalizeEmail(sub.email);
    const monthlyCents = subscriptionMonthlyCents(sub);

    const base = {
      subscriptionId: sub.id,
      email: email || null,
      name: sub.name,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
      monthlyCents,
    };

    if (!email) {
      return { ...base, outcome: 'conflict' as const, conflict: 'no-email' as const, userOrgId: null };
    }

    if ((seen.get(email) ?? 0) > 1) {
      return {
        ...base,
        outcome: 'conflict' as const,
        conflict: 'duplicate-email' as const,
        userOrgId: null,
      };
    }

    const member = byEmail.get(email);

    if (!member) {
      return { ...base, outcome: 'create' as const, conflict: null, userOrgId: null };
    }

    if (member.stripeSubscriptionId === sub.id) {
      return {
        ...base,
        outcome: 'already-linked' as const,
        conflict: null,
        userOrgId: member.userOrgId,
      };
    }

    if (member.stripeSubscriptionId) {
      return {
        ...base,
        outcome: 'conflict' as const,
        conflict: 'member-has-other-subscription' as const,
        userOrgId: member.userOrgId,
      };
    }

    return { ...base, outcome: 'link' as const, conflict: null, userOrgId: member.userOrgId };
  });
}

export interface ScanSummary {
  subscriptions: {
    total: number;
    byStatus: Record<string, number>;
    cancelingAtPeriodEnd: number;
    /** Metered or tiered prices, left out of every money figure below. */
    unpriced: number;
  };
  people: {
    link: number;
    create: number;
    alreadyLinked: number;
    conflicts: number;
    byConflict: Record<string, number>;
    /** Members MaybeOS holds that no live subscription matched. */
    membersWithoutSubscription: number;
  };
  money: {
    /** Sum of active and trialing subscriptions, per month. */
    stripeMonthlyCents: number;
    /** What MaybeOS currently believes it bills, per month. */
    maybeosMonthlyCents: number;
    deltaCents: number;
    /** Money at risk rather than money collected — reported apart. */
    pastDueMonthlyCents: number;
  };
}

/**
 * The numbers that decide whether the match is good enough to act on.
 *
 * `deltaCents` is the one that matters. Two systems, one figure: if MaybeOS's
 * recorded dues do not add up to what Stripe is actually collecting, the
 * difference is the list of members it would get wrong.
 */
export function summarize(
  subs: ScanSubscription[],
  rows: PlannedRow[],
  members: MemberSnapshot[],
): ScanSummary {
  const byStatus: Record<string, number> = {};
  let unpriced = 0;
  let cancelingAtPeriodEnd = 0;
  let stripeMonthlyCents = 0;
  let pastDueMonthlyCents = 0;

  for (const sub of subs) {
    byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1;
    if (sub.cancelAtPeriodEnd) cancelingAtPeriodEnd++;

    const monthly = subscriptionMonthlyCents(sub);
    if (monthly === null) {
      unpriced++;
      continue;
    }
    if (EARNING_STATUSES.includes(sub.status)) stripeMonthlyCents += monthly;
    if (sub.status === 'past_due') pastDueMonthlyCents += monthly;
  }

  const byConflict: Record<string, number> = {};
  let link = 0;
  let create = 0;
  let alreadyLinked = 0;
  let conflicts = 0;

  for (const row of rows) {
    if (row.outcome === 'link') link++;
    if (row.outcome === 'create') create++;
    if (row.outcome === 'already-linked') alreadyLinked++;
    if (row.outcome === 'conflict') {
      conflicts++;
      if (row.conflict) byConflict[row.conflict] = (byConflict[row.conflict] ?? 0) + 1;
    }
  }

  const matchedEmails = new Set(
    rows.filter((row) => row.email).map((row) => row.email as string),
  );

  const maybeosMonthlyCents = members.reduce(
    (total, member) =>
      EARNING_STATUSES.includes(member.subscriptionStatus.toLowerCase())
        ? total + (member.tierMonthlyCents ?? 0)
        : total,
    0,
  );

  return {
    subscriptions: {
      total: subs.length,
      byStatus,
      cancelingAtPeriodEnd,
      unpriced,
    },
    people: {
      link,
      create,
      alreadyLinked,
      conflicts,
      byConflict,
      membersWithoutSubscription: members.filter((m) => !matchedEmails.has(m.email)).length,
    },
    money: {
      stripeMonthlyCents,
      maybeosMonthlyCents,
      deltaCents: stripeMonthlyCents - maybeosMonthlyCents,
      pastDueMonthlyCents,
    },
  };
}
