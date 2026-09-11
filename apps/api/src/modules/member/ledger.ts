/**
 * The co-op's equity ledger, computed (MEM-17).
 *
 * A redesigned Directory that reads like a cap table: every member, what they
 * hold, and what share of the co-op that is — visible to the whole co-op,
 * because in a cooperative who owns what is everybody's business.
 *
 * Pure, so the arithmetic that decides what every member is told they own can
 * be tested without a database. Three rules shape it:
 *
 * - **Every share is somewhere.** A holder who hid their profile, or who holds
 *   shares without a MaybeOS membership yet, is counted in an unnamed row
 *   rather than dropped, so the column always adds up to the total.
 * - **`isPublic` still means what it said.** A member who hid from the
 *   directory is not named on its replacement. Organisers see them, as the
 *   directory always let them, marked so they know others do not.
 * - **No email, no phone, ever.** Emails exist here only to match a grant to a
 *   member, and no row is built from anything that carries one.
 */

export const GRANT_KINDS = [
  'ANNUAL',
  'FOUNDER',
  'BELIEVER',
  'BOUNTY',
  'REFERRAL',
  'ADJUSTMENT',
] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

export interface GrantLine {
  holderEmail: string;
  kind: GrantKind;
  shares: number;
}

export interface LedgerMember {
  userId: string;
  /** For matching only. Never copied onto a row. */
  email: string;
  name: string | null;
  avatarUrl: string | null;
  avatarPath: string | null;
  role: string;
  isPublic: boolean;
  memberSince: Date;
  headline: string | null;
  bio: string | null;
  location: string | null;
  tags: string[];
  links: string[];
}

export interface LedgerViewer {
  userId: string;
  privileged: boolean;
}

export interface LedgerHolder {
  rank: number;
  userId: string;
  isYou: boolean;
  /** Hidden from other members. Only ever true on an organiser's view. */
  isPrivate: boolean;
  role: string;
  memberSince: Date;
  shares: number;
  breakdown: Partial<Record<GrantKind, number>>;
  /** Named `user` with `avatarPath` inside, so the global interceptor signs it. */
  user: { id: string; name: string | null; avatarUrl: string | null; avatarPath: string | null };
  headline: string | null;
  bio: string | null;
  location: string | null;
  tags: string[];
  links: string[];
}

export interface Ledger {
  totalShares: number;
  holders: LedgerHolder[];
  /** Members who hid their profile: counted, not named. */
  privateMembers: { count: number; shares: number };
  /** Holders on the cap table with no MaybeOS membership here yet. */
  unlinked: { count: number; shares: number };
  /** Every share in exactly one place. False means the page would lie. */
  reconciled: boolean;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function computeLedger(
  grants: GrantLine[],
  members: LedgerMember[],
  viewer: LedgerViewer,
): Ledger {
  const held = new Map<string, { shares: number; breakdown: Partial<Record<GrantKind, number>> }>();
  let totalShares = 0;

  for (const grant of grants) {
    const email = normalizeEmail(grant.holderEmail);
    const entry = held.get(email) ?? { shares: 0, breakdown: {} };
    entry.shares += grant.shares;
    entry.breakdown[grant.kind] = (entry.breakdown[grant.kind] ?? 0) + grant.shares;
    held.set(email, entry);
    totalShares += grant.shares;
  }

  const memberEmails = new Set<string>();
  const holders: Omit<LedgerHolder, 'rank'>[] = [];
  const privateMembers = { count: 0, shares: 0 };

  for (const member of members) {
    const email = normalizeEmail(member.email);
    memberEmails.add(email);
    const holding = held.get(email);
    const shares = holding?.shares ?? 0;

    const isYou = member.userId === viewer.userId;
    const visible = member.isPublic || viewer.privileged || isYou;

    if (!visible) {
      privateMembers.count++;
      privateMembers.shares += shares;
      continue;
    }

    holders.push({
      userId: member.userId,
      isYou,
      isPrivate: !member.isPublic,
      role: member.role,
      memberSince: member.memberSince,
      shares,
      breakdown: holding?.breakdown ?? {},
      user: {
        id: member.userId,
        name: member.name,
        avatarUrl: member.avatarUrl,
        avatarPath: member.avatarPath,
      },
      headline: member.headline,
      bio: member.bio,
      location: member.location,
      tags: member.tags,
      links: member.links,
    });
  }

  const unlinked = { count: 0, shares: 0 };
  for (const [email, holding] of held) {
    if (memberEmails.has(email)) continue;
    unlinked.count++;
    unlinked.shares += holding.shares;
  }

  // Largest first, as a cap table reads; ties by name so the order is stable.
  holders.sort(
    (a, b) =>
      b.shares - a.shares ||
      (a.user.name ?? '￿').localeCompare(b.user.name ?? '￿'),
  );

  const named = holders.reduce((sum, holder) => sum + holder.shares, 0);

  return {
    totalShares,
    holders: holders.map((holder, index) => ({ rank: index + 1, ...holder })),
    privateMembers,
    unlinked,
    reconciled: named + privateMembers.shares + unlinked.shares === totalShares,
  };
}

/** One row of the co-op's cap table, after the browser has found its columns. */
export interface CapTableRowInput {
  name?: string | null;
  email?: string | null;
  annual?: number;
  founder?: number;
  believer?: number;
  bounty?: number;
  referral?: number;
  totalShares: number;
}

const COMPONENTS: Array<[keyof CapTableRowInput, GrantKind]> = [
  ['annual', 'ANNUAL'],
  ['founder', 'FOUNDER'],
  ['believer', 'BELIEVER'],
  ['bounty', 'BOUNTY'],
  ['referral', 'REFERRAL'],
];

export interface ImportPlan {
  lines: Array<GrantLine & { holderName: string | null }>;
  rows: number;
  holders: number;
  importedShares: number;
  sheetTotal: number | null;
  /** Null when the sheet gave no total to check against. */
  matchesSheet: boolean | null;
  skipped: Array<{ name: string | null; shares: number; reason: 'no-email' }>;
  adjusted: Array<{ name: string | null; parts: number; total: number }>;
  repeatedEmails: number;
}

const whole = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * What importing the cap table would write.
 *
 * Each non-zero column becomes a line. `Total Shares` is the sheet's own word
 * for what a person holds, so where its parts disagree, an ADJUSTMENT makes the
 * balance match it — MaybeItsFate's sheet has one such row, and its own total
 * is built from `Total Shares`, not the parts.
 *
 * A row with no email is not imported: there is no member it could ever belong
 * to. The MaybeItsFate LLC row is that row, and the sheet's own total leaves
 * it out too — it describes the same ten million shares its two founders hold.
 */
export function planImport(rows: CapTableRowInput[], sheetTotal: number | null): ImportPlan {
  const lines: ImportPlan['lines'] = [];
  const skipped: ImportPlan['skipped'] = [];
  const adjusted: ImportPlan['adjusted'] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const name = row.name?.trim() || null;
    const email = normalizeEmail(row.email);
    const total = whole(row.totalShares);

    if (!email.includes('@')) {
      if (name || total !== 0) skipped.push({ name, shares: total, reason: 'no-email' });
      continue;
    }

    seen.set(email, (seen.get(email) ?? 0) + 1);

    let parts = 0;
    for (const [key, kind] of COMPONENTS) {
      const shares = whole(row[key]);
      if (shares === 0) continue;
      lines.push({ holderEmail: email, holderName: name, kind, shares });
      parts += shares;
    }

    if (parts !== total) {
      lines.push({ holderEmail: email, holderName: name, kind: 'ADJUSTMENT', shares: total - parts });
      adjusted.push({ name, parts, total });
    }
  }

  const importedShares = lines.reduce((sum, line) => sum + line.shares, 0);

  return {
    lines,
    rows: rows.length,
    holders: seen.size,
    importedShares,
    sheetTotal,
    matchesSheet: sheetTotal === null ? null : importedShares === sheetTotal,
    skipped,
    adjusted,
    repeatedEmails: [...seen.values()].filter((count) => count > 1).length,
  };
}
