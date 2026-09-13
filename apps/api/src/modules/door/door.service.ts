import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { DoorSheetService, DoorRow } from './door-sheet.service';
import { generateDoorPin } from './door-pin';

/**
 * Door codes, and the sheet the door reads (DOR-01).
 *
 * Charley: a new member should get a code, a row in the co-op's sheet, and an
 * email telling them what it is.
 *
 * Done by reconciliation rather than by hooking the moment a member is
 * created, and that is the important decision here. There are seven places in
 * MaybeOS that create a membership — an organiser adding somebody, a public
 * join, an invitation accepted, a CSV import, the founder at org creation, the
 * Stripe adoption, the forum seed — and a rule attached to one of them is a
 * rule the other six break. Every fifteen minutes this asks the only question
 * that matters: *who is a member with no code, or a code the sheet has not
 * heard about, or a code we never told them?* Members created by a path
 * nobody has written yet are covered by it too.
 *
 * The cost is a delay of up to a quarter of an hour between joining and the
 * door working. For a building that is the right trade; for the member it is
 * invisible, because they are told by email when it is true rather than
 * promised it in advance.
 */

/** How many members are issued, synced or emailed in one pass. */
const BATCH = 500;

@Injectable()
export class DoorService {
  private readonly logger = new Logger(DoorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheet: DoorSheetService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** The co-ops that have switched this on and named a sheet. */
  private async doorOrgs() {
    return this.prisma.organization.findMany({
      where: { doorAccessEnabled: true, doorSheetId: { not: null } },
      select: {
        id: true,
        name: true,
        slug: true,
        doorSheetId: true,
        doorCodeEmailsEnabled: true,
      },
    });
  }

  /**
   * Give a code to every member of this co-op who has not got one.
   *
   * The unique index on `(orgId, doorPin)` is what actually decides, not a
   * check-then-write: two passes running at once — a scheduled one and an
   * organiser pressing the button — would otherwise both find the same code
   * free and both use it. A collision is simply retried with new letters.
   */
  async issuePins(orgId: string): Promise<number> {
    const waiting = await this.prisma.userOrg.findMany({
      where: { orgId, doorPin: null },
      select: { id: true },
      take: BATCH,
    });

    let issued = 0;
    for (const membership of waiting) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await this.prisma.userOrg.update({
            where: { id: membership.id },
            data: { doorPin: generateDoorPin(), doorPinIssuedAt: new Date() },
          });
          issued += 1;
          break;
        } catch (error) {
          // P2002 is the unique index doing its job: those five letters are
          // taken in this co-op. Anything else is a real failure.
          if ((error as { code?: string }).code !== 'P2002') throw error;
          if (attempt === 4) {
            this.logger.error(
              `Could not find a free door code for membership ${membership.id} in five tries.`,
            );
          }
        }
      }
    }

    return issued;
  }

  /**
   * Write this co-op's members into its sheet.
   *
   * `doorPinSyncedAt` is set only after the sheet has actually taken them, so
   * a failure halfway leaves the rest outstanding and the next pass picks them
   * up. Marking first and writing second would lose people quietly, which for
   * a door means somebody standing outside with a code that opens nothing.
   */
  async syncSheet(orgId: string, sheetId: string): Promise<number> {
    const pending = await this.prisma.userOrg.findMany({
      // Outstanding means `doorPinSyncedAt` is null, and nothing else. A new
      // code clears it — see `regenerate` — so one flag carries both "never
      // written" and "written, then changed", instead of a column comparison
      // that has to stay in step with every place a code is set.
      where: { orgId, doorPin: { not: null }, doorPinSyncedAt: null },
      // The one place besides the member's own profile and the organisers'
      // list that reads the code, and it says so explicitly — the client
      // omits it everywhere else.
      select: {
        id: true,
        doorPin: true,
        user: { select: { email: true, name: true } },
      },
      take: BATCH,
    });

    if (pending.length === 0) return 0;

    const rows: DoorRow[] = pending.map((m) => ({
      email: m.user.email,
      pin: m.doorPin as string,
      name: m.user.name ?? '',
    }));

    await this.sheet.syncRows(sheetId, rows);

    await this.prisma.userOrg.updateMany({
      where: { id: { in: pending.map((m) => m.id) } },
      data: { doorPinSyncedAt: new Date() },
    });

    return rows.length;
  }

  /**
   * Tell members their code, once the co-op has asked for that to happen.
   *
   * Its own switch. Charley's instruction on the first run was to fill the
   * sheet and email nobody — a few hundred door codes arriving unannounced is
   * not something to set off by deploying.
   *
   * Only members whose row is already in the sheet: an email saying the door
   * works, sent before the door works, is worse than a late one.
   */
  async emailPending(org: {
    id: string;
    name: string;
    slug: string;
  }): Promise<number> {
    const waiting = await this.prisma.userOrg.findMany({
      where: {
        orgId: org.id,
        doorPin: { not: null },
        doorPinSyncedAt: { not: null },
        doorPinEmailedAt: null,
      },
      select: {
        id: true,
        doorPin: true,
        user: { select: { email: true, name: true } },
      },
      take: BATCH,
    });

    const base = this.config.get<string>('WEB_URL') ?? 'https://maybeos.org';

    let sent = 0;
    for (const membership of waiting) {
      await this.email.sendDoorCode(membership.user.email, {
        memberName: membership.user.name ?? 'there',
        orgName: org.name,
        pin: membership.doorPin as string,
        profileUrl: `${base}/member/${org.slug}/profile`,
      });
      // `EmailService.send` swallows delivery failures by design, so this
      // records that we tried. A member who never got it asks, and the code
      // is on their profile either way.
      await this.prisma.userOrg.update({
        where: { id: membership.id },
        data: { doorPinEmailedAt: new Date() },
      });
      sent += 1;
    }

    return sent;
  }

  /**
   * One co-op's full pass: issue what is missing, write the sheet, tell
   * anybody who has not been told.
   *
   * Every step is idempotent, so an organiser pressing "sync now" while the
   * scheduled pass is running costs a duplicated read and nothing else.
   */
  async syncOrg(orgId: string): Promise<{ issued: number; synced: number; emailed: number }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        doorAccessEnabled: true,
        doorSheetId: true,
        doorCodeEmailsEnabled: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    if (!org.doorAccessEnabled || !org.doorSheetId) {
      // Not an error: a co-op that has not turned this on has nothing
      // outstanding, and saying so beats a refusal an organiser has to decode.
      return { issued: 0, synced: 0, emailed: 0 };
    }

    const issued = await this.issuePins(org.id);
    const synced = await this.syncSheet(org.id, org.doorSheetId);
    const emailed = org.doorCodeEmailsEnabled ? await this.emailPending(org) : 0;

    return { issued, synced, emailed };
  }

  /** One pass over every co-op with a door. Called by the scheduler. */
  async runDue(): Promise<{ issued: number; synced: number; emailed: number }> {
    if (!this.sheet.isConfigured) return { issued: 0, synced: 0, emailed: 0 };

    const totals = { issued: 0, synced: 0, emailed: 0 };

    for (const org of await this.doorOrgs()) {
      try {
        const done = await this.syncOrg(org.id);
        totals.issued += done.issued;
        totals.synced += done.synced;
        totals.emailed += done.emailed;
      } catch (error) {
        // One co-op's sheet being unshared must not stop another's door.
        this.logger.error(
          `Door sync failed for ${org.slug}: ${(error as Error).message}`,
        );
      }
    }

    return totals;
  }

  /** A member's own code, for their profile. */
  async pinFor(orgId: string, userId: string): Promise<{ doorPin: string | null }> {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { doorPin: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this organization');

    return { doorPin: membership.doorPin };
  }

  /**
   * Replace a member's code (DOR-01).
   *
   * The lost-code path, and the leaked-code path: an organiser issues new
   * letters, the sheet is rewritten on the next pass, and the old code stops
   * working then. Clearing `doorPinSyncedAt` is what queues that rewrite, and
   * clearing `doorPinEmailedAt` is what tells them the new one.
   */
  async regenerate(orgId: string, userId: string): Promise<{ doorPin: string }> {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this organization');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const doorPin = generateDoorPin();
      try {
        await this.prisma.userOrg.update({
          where: { id: membership.id },
          data: {
            doorPin,
            doorPinIssuedAt: new Date(),
            doorPinSyncedAt: null,
            doorPinEmailedAt: null,
          },
        });
        return { doorPin };
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }

    throw new NotFoundException('Could not find a free door code. Try again.');
  }
}
