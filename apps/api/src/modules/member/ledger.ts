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
  /** The member it names (MEM-19). Wins over the email when present. */
  userId?: string | null;
  holderName?: string | null;
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

type Holding = { shares: number; breakdown: Partial<Record<GrantKind, number>> };

const credit = (holding: Holding, grant: GrantLine) => {
  holding.shares += grant.shares;
  holding.breakdown[grant.kind] = (holding.breakdown[grant.kind] ?? 0) + grant.shares;
};

/**
 * Whose each line is (MEM-19).
 *
 * A line naming a member (`userId`) is theirs — every grant made in MaybeOS,
 * and every imported line whose email matched a member at import. A line
 * naming only an email belongs to whichever member holds that address here.
 *
 * A line naming somebody who has since left belongs to **no current member**.
 * It does not fall back to its email, which may by now belong to somebody
 * else: shares do not move between people because an address did.
 */
export function attribute(grants: GrantLine[], members: Pick<LedgerMember, 'userId' | 'email'>[]) {
  const byUser = new Map(members.map((m) => [m.userId, m.userId]));
  const byEmail = new Map(members.map((m) => [normalizeEmail(m.email), m.userId]));

  const held = new Map<string, Holding>();
  const unlinked = new Map<string, Holding & { name: string | null }>();
  let totalShares = 0;

  for (const grant of grants) {
    totalShares += grant.shares;
    const owner = grant.userId ? byUser.get(grant.userId) : byEmail.get(normalizeEmail(grant.holderEmail));

    if (owner) {
      const holding = held.get(owner) ?? { shares: 0, breakdown: {} };
      credit(holding, grant);
      held.set(owner, holding);
      continue;
    }

    const key = grant.userId ? `user:${grant.userId}` : `email:${normalizeEmail(grant.holderEmail)}`;
    const holding = unlinked.get(key) ?? { shares: 0, breakdown: {}, name: grant.holderName ?? null };
    credit(holding, grant);
    unlinked.set(key, holding);
  }

  return { held, unlinked, totalShares };
}

/**
 * Whether a grant is one an admin may make (MEM-19). A message when not.
 *
 * Grants are whole, non-zero shares. Only an adjustment goes down, and an
 * adjustment corrects one member's balance — a negative figure applied to a
 * whole selection at once is how a slip becomes a mass correction.
 */
export function grantProblem(kind: GrantKind, shares: number, members: number): string | null {
  if (!Number.isInteger(shares) || shares === 0) return 'Grant a whole number of shares, other than zero.';
  if (Math.abs(shares) > 1_000_000_000) return 'That is more shares than a single grant can carry.';
  if (shares < 0 && kind !== 'ADJUSTMENT') return 'Only an adjustment can take shares away.';
  if (members > 1 && shares < 0) return 'Shares can be taken away from one member at a time, not a selection.';
  if (members > 1 && kind === 'ADJUSTMENT') return 'Adjustments correct one member at a time. Grant a kind of share to a selection.';
  if (shares * members > 2_000_000_000) return 'Together that is more shares than the ledger can hold.';
  return null;
}

export function computeLedger(
  grants: GrantLine[],
  members: LedgerMember[],
  viewer: LedgerViewer,
): Ledger {
  const { held, unlinked: stray, totalShares } = attribute(grants, members);

  const holders: Omit<LedgerHolder, 'rank'>[] = [];
  const privateMembers = { count: 0, shares: 0 };

  for (const member of members) {
    const holding = held.get(member.userId);
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

  const unlinked = { count: stray.size, shares: 0 };
  for (const holding of stray.values()) unlinked.shares += holding.shares;

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
