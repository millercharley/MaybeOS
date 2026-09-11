import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { computeLedger, LedgerViewer, normalizeEmail, planImport } from './ledger';
import { ImportLedgerDto } from './dto/import-ledger.dto';

/** Who is on the ledger: members of the co-op, not its guests. */
const LEDGER_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The ledger as one member sees it (MEM-17).
   *
   * Two email columns are read here — the grant's and the member's — and both
   * only to match one to the other. Neither is copied onto a row: the ledger
   * is shaped from named fields, never by spreading a record, so an address
   * cannot ride along on a field somebody added later.
   */
  async getLedger(orgId: string, viewer: LedgerViewer) {
    const [grants, memberships, latest] = await Promise.all([
      this.prisma.shareGrant.findMany({
        where: { orgId },
        // Named in `select`, which lifts the client-level omit for this query
        // alone. The one place in the codebase that should read it.
        select: { holderEmail: true, kind: true, shares: true },
      }),
      this.prisma.userOrg.findMany({
        where: { orgId, role: { in: [...LEDGER_ROLES] } },
        select: {
          userId: true,
          role: true,
          isPublic: true,
          memberSince: true,
          headline: true,
          bio: true,
          location: true,
          tags: true,
          links: true,
          user: {
            select: { id: true, email: true, name: true, avatarUrl: true, avatarPath: true },
          },
        },
      }),
      this.prisma.shareGrant.aggregate({ where: { orgId }, _max: { importedAt: true } }),
    ]);

    const ledger = computeLedger(
      grants,
      memberships.map((m) => ({
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
      })),
      viewer,
    );

    if (!ledger.reconciled) {
      // Should be impossible by construction; if it ever is not, a co-op is
      // being shown ownership figures that do not add up, and that must be
      // loud somewhere even if the page itself cannot say why.
      this.logger.error(`Ledger for org ${orgId} does not reconcile to its own total`);
    }

    return { asOf: latest._max.importedAt, ...ledger };
  }

  /**
   * Import the co-op's cap table (MEM-17). ADMIN only.
   *
   * `dryRun` defaults to true: the preview is the same reckoning with the
   * write switched off. A real import replaces the whole ledger in one
   * transaction, so a re-import after the sheet changes is exact rather than
   * cumulative, and a failure half way leaves the previous ledger standing.
   *
   * **Refuses to publish a ledger that disagrees with the sheet's own total**
   * unless told the difference is understood. This is the number every member
   * is told they own; showing the whole co-op a cap table that does not match
   * the one the treasurer keeps is the specific harm worth stopping at.
   */
  async importCapTable(orgId: string, dto: ImportLedgerDto) {
    const dryRun = dto.dryRun !== false;
    const plan = planImport(dto.rows, dto.sheetTotal ?? null);

    const members = await this.prisma.userOrg.findMany({
      where: { orgId, role: { in: [...LEDGER_ROLES] } },
      select: { user: { select: { email: true } } },
    });
    const memberEmails = new Set(members.map((m) => normalizeEmail(m.user.email)));
    const holderEmails = new Set(plan.lines.map((line) => line.holderEmail));
    const linked = [...holderEmails].filter((email) => memberEmails.has(email)).length;

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
        this.prisma.shareGrant.deleteMany({ where: { orgId } }),
        this.prisma.shareGrant.createMany({
          data: plan.lines.map((line) => ({
            orgId,
            holderEmail: line.holderEmail,
            holderName: line.holderName,
            kind: line.kind,
            shares: line.shares,
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
      skipped: plan.skipped,
      adjusted: plan.adjusted,
      repeatedEmails: plan.repeatedEmails,
    };
  }
}
