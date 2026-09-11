import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import {
  attribute,
  computeLedger,
  grantProblem,
  LedgerMember,
  LedgerViewer,
  normalizeEmail,
  planImport,
} from './ledger';
import { GrantSharesDto, ImportLedgerDto, SetTotalDto } from './dto/import-ledger.dto';

/** Who is on the ledger: members of the co-op, not its guests. */
const LEDGER_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

const OFF = 'Share tracking is off for this co-op. An admin can turn it on in Settings.';

const MEMBER_SELECT = {
  userId: true,
  role: true,
  isPublic: true,
  memberSince: true,
  headline: true,
  bio: true,
  location: true,
  tags: true,
  links: true,
  tier: { select: { name: true } },
  user: { select: { id: true, email: true, name: true, avatarUrl: true, avatarPath: true } },
} as const;

type MemberRow = {
  userId: string;
  role: string;
  isPublic: boolean;
  memberSince: Date;
  headline: string | null;
  bio: string | null;
  location: string | null;
  tags: string[];
  links: string[];
  tier: { name: string } | null;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; avatarPath: string | null };
};

const toLedgerMember = (m: MemberRow): LedgerMember => ({
  userId: m.userId,
  email: m.user.email,
  name: m.user.name,
  avatarUrl: m.user.avatarUrl,
  avatarPath: m.user.avatarPath,
  role: m.role,
  isPublic: m.isPublic,
  memberSince: m.memberSince,
  headline: m.headline,
  bio: m.bio,
  location: m.location,
  tags: m.tags,
  links: m.links,
});

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async sharesEnabled(orgId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { sharesEnabled: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org.sharesEnabled;
  }

  private async requireEnabled(orgId: string) {
    if (!(await this.sharesEnabled(orgId))) throw new BadRequestException(OFF);
  }

  /**
   * The lines that belong to one member: those naming them, and those naming
   * only their email. Mirrors `attribute` exactly, so the history an admin
   * reads and the balance the ledger shows can never disagree.
   */
  private ownedBy(orgId: string, userId: string, email: string) {
    return {
      orgId,
      OR: [{ userId }, { userId: null, holderEmail: normalizeEmail(email) }],
    };
  }

  private readMembers(orgId: string) {
    return this.prisma.userOrg.findMany({
      where: { orgId, role: { in: [...LEDGER_ROLES] } },
      select: MEMBER_SELECT,
    }) as Promise<MemberRow[]>;
  }

  private readGrants(orgId: string) {
    return this.prisma.shareGrant.findMany({
      where: { orgId },
      // Named in `select`, which lifts the client-level omit on the email for
      // this query alone — used to match, never returned.
      select: { holderEmail: true, userId: true, holderName: true, kind: true, shares: true, source: true },
    });
  }

  /**
   * The Members page, as one member sees it (MEM-17, MEM-19).
   *
   * With share tracking off, no grant is read at all — not read and hidden,
   * unread — and the page is a directory. With it on, every member sees every
   * member's holding.
   */
  async getLedger(orgId: string, viewer: LedgerViewer) {
    const enabled = await this.sharesEnabled(orgId);
    const [grants, memberships, latest] = await Promise.all([
      enabled ? this.readGrants(orgId) : Promise.resolve([]),
      this.readMembers(orgId),
      enabled
        ? this.prisma.shareGrant.aggregate({ where: { orgId }, _max: { importedAt: true } })
        : Promise.resolve(null),
    ]);

    const ledger = computeLedger(grants, memberships.map(toLedgerMember), viewer);

    if (enabled && !ledger.reconciled) {
      this.logger.error(`Ledger for org ${orgId} does not reconcile to its own total`);
    }

    return { sharesEnabled: enabled, asOf: latest?._max.importedAt ?? null, ...ledger };
  }

  /**
   * Every member with their holding, for the admin's Shares page (MEM-19).
   * Hidden members included, as organisers always see them. Holders from the
   * cap table who are not in MaybeOS yet are named — the admin imported that
   * sheet — but never by address.
   */
  async getAdminView(orgId: string) {
    const enabled = await this.sharesEnabled(orgId);
    const [grants, memberships] = await Promise.all([
      enabled ? this.readGrants(orgId) : Promise.resolve([]),
      this.readMembers(orgId),
    ]);
    const lastImport = enabled
      ? await this.prisma.shareGrant.aggregate({
          where: { orgId, source: 'IMPORT' },
          _max: { importedAt: true },
        })
      : null;

    const { held, unlinked, totalShares } = attribute(grants, memberships.map(toLedgerMember));
    const sum = (source: 'IMPORT' | 'MANUAL') =>
      grants.filter((g) => g.source === source).reduce((total, g) => total + g.shares, 0);

    return {
      sharesEnabled: enabled,
      totalShares,
      importedShares: sum('IMPORT'),
      grantedShares: sum('MANUAL'),
      lastImportAt: lastImport?._max.importedAt ?? null,
      members: memberships
        .map((m) => ({
          userId: m.userId,
          role: m.role,
          isPublic: m.isPublic,
          tierName: m.tier?.name ?? null,
          shares: held.get(m.userId)?.shares ?? 0,
          breakdown: held.get(m.userId)?.breakdown ?? {},
          // `avatarPath` inside `user`, so the global interceptor signs it.
          user: {
            id: m.user.id,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl,
            avatarPath: m.user.avatarPath,
          },
        }))
        .sort((a, b) => b.shares - a.shares || (a.user.name ?? '').localeCompare(b.user.name ?? '')),
      unlinked: [...unlinked.values()]
        .map((holding) => ({ name: holding.name, shares: holding.shares }))
        .sort((a, b) => b.shares - a.shares),
    };
  }

  /** One member's lines, newest first, with who recorded each (MEM-19). */
  async getHistory(orgId: string, userId: string) {
    await this.requireEnabled(orgId);
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { user: { select: { email: true } } },
    });
    if (!member) throw new NotFoundException('Not a member of this co-op');

    const lines = await this.prisma.shareGrant.findMany({
      where: this.ownedBy(orgId, userId, member.user.email),
      orderBy: { importedAt: 'desc' },
      select: { id: true, kind: true, shares: true, source: true, note: true, importedAt: true, grantedById: true },
    });

    const granterIds = [...new Set(lines.map((l) => l.grantedById).filter((id): id is string => Boolean(id)))];
    const granters = granterIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(granters.map((g) => [g.id, g.name]));

    return {
      balance: lines.reduce((total, line) => total + line.shares, 0),
      lines: lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        shares: line.shares,
        source: line.source,
        note: line.note,
        recordedAt: line.importedAt,
        grantedBy: line.grantedById ? (names.get(line.grantedById) ?? null) : null,
      })),
    };
  }

  /**
   * Grant shares to one member or to a selection at once (MEM-19).
   *
   * All or nothing: if anyone chosen is not a member of this co-op, nobody is
   * granted anything. A partial bulk grant is the kind that gets noticed
   * months later, by the member it skipped.
   */
  async grant(orgId: string, adminId: string, dto: GrantSharesDto) {
    await this.requireEnabled(orgId);
    const userIds = [...new Set(dto.userIds)];

    const problem = grantProblem(dto.kind, dto.shares, userIds.length);
    if (problem) throw new BadRequestException(problem);

    const members = await this.prisma.userOrg.findMany({
      where: { orgId, userId: { in: userIds }, role: { in: [...LEDGER_ROLES] } },
      select: { userId: true, user: { select: { email: true, name: true } } },
    });
    if (members.length !== userIds.length) {
      throw new BadRequestException(
        'Some of the people chosen are not members of this co-op, so nothing was granted.',
      );
    }

    const note = dto.note?.trim() || null;
    await this.prisma.shareGrant.createMany({
      data: members.map((m) => ({
        orgId,
        userId: m.userId,
        holderEmail: normalizeEmail(m.user.email),
        holderName: m.user.name,
        kind: dto.kind,
        shares: dto.shares,
        source: 'MANUAL' as const,
        note,
        grantedById: adminId,
      })),
    });

    return { members: members.length, sharesEach: dto.shares, totalGranted: dto.shares * members.length };
  }

  /**
   * Set a member's balance to a figure, by recording the difference (MEM-19).
   *
   * Never an edit to history: the correction is its own line, dated and
   * attributed, and the lines before it stay as they were.
   *
   * `expectedCurrent` is the balance the admin was looking at. If it moved
   * while they typed — another admin, an import — nothing is written, because
   * a difference worked out from a stale balance is a wrong number presented
   * as a right one.
   */
  async setTotal(orgId: string, adminId: string, userId: string, dto: SetTotalDto) {
    await this.requireEnabled(orgId);
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { user: { select: { email: true, name: true } } },
    });
    if (!member) throw new NotFoundException('Not a member of this co-op');

    return this.prisma.$transaction(async (tx) => {
      const sum = await tx.shareGrant.aggregate({
        where: this.ownedBy(orgId, userId, member.user.email),
        _sum: { shares: true },
      });
      const current = sum._sum.shares ?? 0;

      if (current !== dto.expectedCurrent) {
        throw new ConflictException(
          `${member.user.name ?? 'This member'}'s balance changed to ${current.toLocaleString('en-US')} while you were editing. Nothing was changed.`,
        );
      }

      const adjustment = dto.total - current;
      if (adjustment === 0) return { changed: false, total: current, adjustment: 0 };

      await tx.shareGrant.create({
        data: {
          orgId,
          userId,
          holderEmail: normalizeEmail(member.user.email),
          holderName: member.user.name,
          kind: 'ADJUSTMENT',
          shares: adjustment,
          source: 'MANUAL',
          note: dto.note?.trim() || null,
          grantedById: adminId,
        },
      });

      return { changed: true, total: dto.total, adjustment };
    });
  }

  /**
   * Import the co-op's cap table (MEM-17). ADMIN only.
   *
   * `dryRun` defaults to true. A real import replaces **the previous import**,
   * never a grant made in MaybeOS (MEM-19) — so the preview says how many
   * shares were granted here, because a sheet that already includes them
   * would count them twice.
   *
   * Refuses to publish a ledger that disagrees with the sheet's own total
   * unless told the difference is understood.
   */
  async importCapTable(orgId: string, dto: ImportLedgerDto) {
    await this.requireEnabled(orgId);
    const dryRun = dto.dryRun !== false;
    const plan = planImport(dto.rows, dto.sheetTotal ?? null);

    const [members, manual] = await Promise.all([
      this.prisma.userOrg.findMany({
        where: { orgId, role: { in: [...LEDGER_ROLES] } },
        select: { userId: true, user: { select: { email: true } } },
      }),
      this.prisma.shareGrant.aggregate({ where: { orgId, source: 'MANUAL' }, _sum: { shares: true } }),
    ]);

    const memberByEmail = new Map(members.map((m) => [normalizeEmail(m.user.email), m.userId]));
    const holderEmails = new Set(plan.lines.map((line) => line.holderEmail));
    const linked = [...holderEmails].filter((email) => memberByEmail.has(email)).length;

    if (!dryRun) {
      if (plan.lines.length === 0) {
        throw new BadRequestException('There is nothing in that file to import.');
      }
      if (plan.matchesSheet === false && !dto.acceptMismatch) {
        throw new BadRequestException(
          `The imported shares add up to ${plan.importedShares.toLocaleString('en-US')}, but the sheet's own total says ${(plan.sheetTotal ?? 0).toLocaleString('en-US')}. Nothing was imported.`,
        );
      }

      const importBatch = randomUUID();
      await this.prisma.$transaction([
        this.prisma.shareGrant.deleteMany({ where: { orgId, source: 'IMPORT' } }),
        this.prisma.shareGrant.createMany({
          data: plan.lines.map((line) => ({
            orgId,
            // Stamped where the email matches a member now, so the line stays
            // theirs if they change their address later.
            userId: memberByEmail.get(line.holderEmail) ?? null,
            holderEmail: line.holderEmail,
            holderName: line.holderName,
            kind: line.kind,
            shares: line.shares,
            source: 'IMPORT' as const,
            importBatch,
          })),
        }),
      ]);
    }

    // Names, never addresses — this goes back to a browser.
    return {
      dryRun,
      rows: plan.rows,
      holders: plan.holders,
      lines: plan.lines.length,
      importedShares: plan.importedShares,
      sheetTotal: plan.sheetTotal,
      matchesSheet: plan.matchesSheet,
      linkedToMembers: linked,
      notYetMembers: plan.holders - linked,
      manualShares: manual._sum.shares ?? 0,
      skipped: plan.skipped,
      adjusted: plan.adjusted,
      repeatedEmails: plan.repeatedEmails,
    };
  }
}
