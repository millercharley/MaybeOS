import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { seal, unseal } from '../../common/secret-box';
import { DoorScriptService } from './door-script.service';
import { DoorSheetMember, isDoorScriptUrl } from './door-script';
import { DOOR_ACCESS_WHERE, hasDoorAccess } from './door-access-rule';
import { generateDoorPin } from './door-pin';

/**
 * Door codes, and the sheet the door reads (DOR-01).
 *
 * Charley: a new member should get a code, a row in the co-op's sheet, and an
 * email telling them what it is. Later: lock out members who are cancelled
 * according to Stripe.
 *
 * Done by reconciliation rather than by hooking the moment a member is
 * created. There are seven places in MaybeOS that create a membership, and a
 * rule attached to one of them is a rule the other six break. Every fifteen
 * minutes this works out what the sheet *should* say — every code holder,
 * revoked or not — compares it with what was last written, and sends the
 * difference. A member created by a path nobody has written yet, a
 * cancellation arriving from Stripe, and a member removed from the co-op are
 * all caught the same way.
 *
 * The cost is up to a quarter of an hour between a change and the door
 * knowing about it.
 */

/** How many members are issued, written or emailed in one pass. */
/**
 * Rows per call to the door script (DOR-02).
 *
 * Was 500, so MaybeItsFate's first sync sent all 436 members in a single
 * request to Apps Script. That call takes minutes — Apps Script writes a
 * sheet a row at a time — so Netlify gave up on the HTTP request at ten
 * seconds and the admin was shown "Request failed" while the sync went on to
 * finish perfectly. Every row landed; the only thing that broke was what the
 * screen said about it.
 *
 * A hundred returns while the request is still alive, and makes a full roster
 * a handful of calls rather than fifty.
 */
const BATCH = 100;

/**
 * How long one sync may spend, in milliseconds.
 *
 * The same ten-second ceiling as everything else on Netlify (CAL-05, MEM-23).
 * Checked between batches, never inside one: a batch already sent to Apps
 * Script has changed the sheet, and abandoning it before writing down that it
 * went would send it again on the next run.
 */
const SYNC_DEADLINE_MS = 7_000;

/** The sheet script caps a name at this length; matching it keeps the comparison stable. */
const NAME_LIMIT = 200;

interface DoorOrg {
  id: string;
  name: string;
  slug: string;
  doorAccessEnabled: boolean;
  doorCodeEmailsEnabled: boolean;
  doorScriptUrl: string | null;
  doorScriptSecret: Prisma.JsonValue | null;
}

const DOOR_ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  doorAccessEnabled: true,
  doorCodeEmailsEnabled: true,
  doorScriptUrl: true,
  doorScriptSecret: true,
} as const;

@Injectable()
export class DoorService {
  private readonly logger = new Logger(DoorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly script: DoorScriptService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Give a code to every member of this co-op who may open the door and has
   * not got one. A cancelled member or a guest is not issued one.
   *
   * Codes are words (DOR-01), so the words this co-op already uses are read
   * once and the next code is drawn from what is left. The unique index on
   * `(orgId, doorPin)` still decides, not a check-then-write: two passes
   * running at once would otherwise both draw the same word. A collision
   * simply marks that word taken and draws again.
   */
  async issuePins(orgId: string): Promise<number> {
    const waiting = await this.prisma.userOrg.findMany({
      where: { orgId, doorPin: null, ...DOOR_ACCESS_WHERE },
      select: { id: true },
      take: BATCH,
    });
    if (waiting.length === 0) return 0;

    const taken = await this.codesInUse(orgId);

    let issued = 0;
    for (const membership of waiting) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const doorPin = generateDoorPin(taken);
        try {
          await this.prisma.userOrg.update({
            where: { id: membership.id },
            data: { doorPin, doorPinIssuedAt: new Date() },
          });
          taken.add(doorPin);
          issued += 1;
          break;
        } catch (error) {
          // P2002 is the unique index doing its job: that word is taken in
          // this co-op. Anything else is a real failure.
          if ((error as { code?: string }).code !== 'P2002') throw error;
          taken.add(doorPin);
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

  /** Every code this co-op has already given out, so a new one is not one of them. */
  private async codesInUse(orgId: string): Promise<Set<string>> {
    const rows = await this.prisma.userOrg.findMany({
      where: { orgId, doorPin: { not: null } },
      select: { doorPin: true },
    });
    return new Set(rows.map((row) => row.doorPin as string));
  }

  /**
   * Bring the co-op's sheet up to date, and return how many rows were sent.
   *
   * What the sheet should hold:
   * - every membership with a code, revoked when `hasDoorAccess` says no;
   * - every email written before whose membership has gone, revoked.
   *
   * Only rows that differ from `door_sheet_entries` are sent, unless `full`
   * is set, which resends everything and repairs a sheet somebody edited by
   * hand. Entries are recorded only after the script accepts a batch, so a
   * failure leaves the rest outstanding for the next pass.
   */
  async syncSheet(
    org: { id: string; doorScriptUrl: string },
    secret: string,
    { full = false }: { full?: boolean } = {},
  ): Promise<{ synced: number; remaining: number }> {
    const [memberships, entries] = await Promise.all([
      this.prisma.userOrg.findMany({
        where: { orgId: org.id, doorPin: { not: null } },
        select: {
          id: true,
          role: true,
          subscriptionStatus: true,
          doorPin: true,
          doorPinSyncedAt: true,
          user: { select: { email: true, name: true } },
        },
      }),
      this.prisma.doorSheetEntry.findMany({ where: { orgId: org.id } }),
    ]);

    const recorded = new Map(entries.map((entry) => [entry.email, entry]));
    const wanted = new Map<string, DoorSheetMember & { membershipId?: string }>();

    for (const m of memberships) {
      const email = m.user.email.trim().toLowerCase();
      wanted.set(email, {
        email,
        code: m.doorPin as string,
        name: (m.user.name ?? '').trim().slice(0, NAME_LIMIT),
        revoked: !hasDoorAccess(m),
        membershipId: m.id,
      });
    }

    // Emails in the sheet with no membership behind them any more: removed
    // from the co-op, account deleted, or an email address changed. Their
    // row stays in the sheet, so it has to say revoked.
    for (const entry of entries) {
      if (!wanted.has(entry.email)) {
        wanted.set(entry.email, {
          email: entry.email,
          code: entry.doorPin,
          name: entry.name,
          revoked: true,
        });
      }
    }

    const changed = [...wanted.values()].filter((row) => {
      if (full) return true;
      const entry = recorded.get(row.email);
      return (
        !entry ||
        entry.doorPin !== row.code ||
        entry.name !== row.name ||
        entry.revoked !== row.revoked
      );
    });

    /*
      Stalest first (DOR-03).

      This mattered the moment the deadline arrived. A full sync resends
      every row — that is what repairs a sheet somebody edited by hand — and
      with the rows in a fixed order, every press sent the *same* first two
      hundred and reported the same number left. Charley pressed twice and
      got "sent 200, 236 still to go" both times, which was true each time
      and never going to stop being true.

      Ordering by when each row last reached the sheet makes a press pick up
      where the last one stopped, because the rows it just wrote now sort to
      the back. Three presses cover a roster this size; the quarter-hourly
      pass does the same thing unattended.
    */
    /*
      Which rows are genuinely behind — missing from the sheet or carrying
      the wrong details (DOR-04).

      Kept apart from `changed`, which on a full sync is everybody by
      definition. Two wrong answers came before this one and both read
      plausibly: `changed.length - sent` meant "everybody minus what I
      managed", and counting rows older than this request meant "not touched
      in this press" — so the two hundred written an hour earlier counted as
      behind, and Charley saw 236 three times running.

      Rows drop out of here as they are written, so what is left at the end
      is what is still wrong. Zero on a healthy sheet, however the sync was
      asked for.
    */
    const outOfSync = new Set(
      [...wanted.values()]
        .filter((row) => {
          const entry = recorded.get(row.email);
          return (
            !entry ||
            entry.doorPin !== row.code ||
            entry.name !== row.name ||
            entry.revoked !== row.revoked
          );
        })
        .map((row) => row.email),
    );

    changed.sort((a, b) => {
      const at = recorded.get(a.email)?.syncedAt?.getTime() ?? 0;
      const bt = recorded.get(b.email)?.syncedAt?.getTime() ?? 0;
      return at - bt;
    });

    let sent = 0;
    const stopBy = Date.now() + SYNC_DEADLINE_MS;

    for (let i = 0; i < changed.length; i += BATCH) {
      // Between batches. Whatever is left is still `changed` next time: the
      // rows this run wrote now match the sheet and drop out of the list.
      if (Date.now() > stopBy) break;

      const batch = changed.slice(i, i + BATCH);
      const members = batch.map(({ email, code, name, revoked }) => ({ email, code, name, revoked }));
      const result = await this.script.upsert(org.doorScriptUrl, secret, members);
      if (result.rejected > 0) {
        this.logger.warn(`Door sheet refused ${result.rejected} row(s) for org ${org.id}`);
      }

      const now = new Date();
      await this.prisma.$transaction(
        batch.map((row) =>
          this.prisma.doorSheetEntry.upsert({
            where: { orgId_email: { orgId: org.id, email: row.email } },
            create: {
              orgId: org.id,
              email: row.email,
              doorPin: row.code,
              name: row.name,
              revoked: row.revoked,
              syncedAt: now,
            },
            update: { doorPin: row.code, name: row.name, revoked: row.revoked, syncedAt: now },
          }),
        ),
      );
      for (const row of batch) outOfSync.delete(row.email);
      sent += batch.length;
    }

    // Everyone whose row now matches the sheet counts as synced, which is
    // what lets `emailPending` tell them. A new code clears the flag
    // (`regenerate`), so the email waits until the sheet has the new code.
    const settled = memberships
      .filter((m) => m.doorPinSyncedAt === null)
      .map((m) => m.id);
    if (settled.length > 0) {
      await this.prisma.userOrg.updateMany({
        where: { id: { in: settled } },
        data: { doorPinSyncedAt: new Date() },
      });
    }

    return { synced: sent, remaining: outOfSync.size };
  }

  /**
   * Tell members their code, once the co-op has asked for that to happen.
   *
   * Its own switch. Charley's instruction on the first run was to fill the
   * sheet and email nobody. Only members who may open the door and whose row
   * is already in the sheet: an email saying the door works, sent before it
   * does, is worse than a late one.
   */
  async emailPending(org: { id: string; name: string; slug: string }): Promise<number> {
    const waiting = await this.prisma.userOrg.findMany({
      where: {
        orgId: org.id,
        doorPin: { not: null },
        doorPinSyncedAt: { not: null },
        doorPinEmailedAt: null,
        ...DOOR_ACCESS_WHERE,
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
      // records that we tried. The code is on their profile either way.
      await this.prisma.userOrg.update({
        where: { id: membership.id },
        data: { doorPinEmailedAt: new Date() },
      });
      sent += 1;
    }

    return sent;
  }

  /**
   * One co-op's full pass: issue what is missing, update the sheet, tell
   * anybody who has not been told. Every step is idempotent.
   */
  async syncOrg(
    orgId: string,
    options: { full?: boolean } = {},
  ): Promise<{ issued: number; synced: number; emailed: number; remaining: number }> {
    const org = await this.loadOrg(orgId);
    const secret = this.secretOf(org);

    if (!org.doorAccessEnabled || !org.doorScriptUrl || !secret) {
      // Not an error: a co-op that has not finished setting this up has
      // nothing outstanding.
      return { issued: 0, synced: 0, emailed: 0, remaining: 0 };
    }

    const issued = await this.issuePins(org.id);
    const sheet = await this.syncSheet(
      { id: org.id, doorScriptUrl: org.doorScriptUrl },
      secret,
      options,
    );

    /*
      Only once the sheet is caught up (DOR-02). Emailing somebody their code
      while their row is still waiting to be written is an email saying the
      door works, sent before it does.
    */
    const emailed =
      org.doorCodeEmailsEnabled && sheet.remaining === 0 ? await this.emailPending(org) : 0;

    return { issued, synced: sheet.synced, emailed, remaining: sheet.remaining };
  }

  /** One pass over every co-op with a door. Called by the scheduler. */
  async runDue(): Promise<{ issued: number; synced: number; emailed: number }> {
    const totals = { issued: 0, synced: 0, emailed: 0 };

    const orgs = await this.prisma.organization.findMany({
      where: { doorAccessEnabled: true, doorScriptUrl: { not: null } },
      select: { id: true, slug: true },
    });

    for (const org of orgs) {
      try {
        const done = await this.syncOrg(org.id);
        totals.issued += done.issued;
        totals.synced += done.synced;
        totals.emailed += done.emailed;
      } catch (error) {
        // One co-op's broken script must not stop another's door.
        this.logger.error(`Door sync failed for ${org.slug}: ${(error as Error).message}`);
      }
    }

    return totals;
  }

  /**
   * A member's own code, for their profile. Null when they may not open the
   * door, so a cancelled member is not shown a code that no longer works.
   */
  async pinFor(orgId: string, userId: string): Promise<{ doorPin: string | null }> {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { doorPin: true, role: true, subscriptionStatus: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this organization');

    return { doorPin: hasDoorAccess(membership) ? membership.doorPin : null };
  }

  /**
   * Replace a member's code: the lost-code and leaked-code path. The sheet is
   * rewritten on the next pass and the old code stops working then.
   */
  async regenerate(orgId: string, userId: string): Promise<{ doorPin: string }> {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this organization');

    // Their own current code counts as taken: a replacement that is the same
    // word has replaced nothing.
    const taken = await this.codesInUse(orgId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const doorPin = generateDoorPin(taken);
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
        taken.add(doorPin);
      }
    }

    throw new NotFoundException('Could not find a free door code. Try again.');
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  /** What an organiser sees: the script address, and whether a secret is set. Never the secret. */
  async setup(orgId: string): Promise<{ scriptUrl: string | null; secretSet: boolean }> {
    const org = await this.loadOrg(orgId);
    return { scriptUrl: org.doorScriptUrl, secretSet: Boolean(this.secretOf(org)) };
  }

  /**
   * Point the co-op at a door script.
   *
   * A different script means a different sheet, so the record of what was
   * written is cleared and the next pass sends everyone.
   */
  async setScriptUrl(orgId: string, url: string | null): Promise<{ scriptUrl: string | null }> {
    const org = await this.loadOrg(orgId);
    const next = url?.trim() || null;
    if (next && !isDoorScriptUrl(next)) {
      throw new BadRequestException(
        'Paste the web app address from Apps Script: https://script.google.com/macros/s/…/exec',
      );
    }

    if (next !== org.doorScriptUrl) {
      await this.prisma.$transaction([
        this.prisma.organization.update({ where: { id: orgId }, data: { doorScriptUrl: next } }),
        this.prisma.doorSheetEntry.deleteMany({ where: { orgId } }),
      ]);
    }

    return { scriptUrl: next };
  }

  /**
   * Make a new signing secret and return it once.
   *
   * MaybeOS generates it so nobody has to invent one or send it anywhere:
   * the organiser copies it from this response straight into the script's
   * Script Properties. It is stored sealed and never returned again. Until
   * the script has the new one, syncs are refused.
   */
  async rotateSecret(orgId: string): Promise<{ secret: string }> {
    await this.loadOrg(orgId);
    const secret = randomBytes(32).toString('base64url');
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { doorScriptSecret: seal(secret) as unknown as Prisma.InputJsonValue },
    });
    return { secret };
  }

  /** Check the script answers and accepts our signature. */
  async test(orgId: string): Promise<{ members: number }> {
    const org = await this.loadOrg(orgId);
    const secret = this.secretOf(org);
    if (!org.doorScriptUrl) throw new BadRequestException('Save the door script address first.');
    if (!secret) throw new BadRequestException('Generate a secret first.');
    return this.script.ping(org.doorScriptUrl, secret);
  }

  private async loadOrg(orgId: string): Promise<DoorOrg> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      // The secret is omitted at the client. An explicit select overrides
      // that, and this is the one place that selects it.
      select: DOOR_ORG_SELECT,
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private secretOf(org: DoorOrg): string | null {
    return org.doorScriptSecret ? unseal<string>(org.doorScriptSecret) : null;
  }
}
