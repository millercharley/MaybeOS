import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { BelongingSettingsService } from './belonging-settings.service';
import { BuddyCandidate, selectCandidate } from './buddy-rotation';
import {
  BelongingEmailKindName,
  DEFAULT_TEMPLATES,
  renderTemplate,
} from './belonging-emails';

/** What an outcome of advancing a pairing was, for logs and for tests. */
export type AdvanceOutcome =
  | { outcome: 'invited'; invitationId: string; candidateId: string; relaxedCooldowns: boolean }
  | { outcome: 'needs-admin'; fallbackId: string | null }
  | { outcome: 'already-pending' }
  | { outcome: 'not-seeking' };

/**
 * The Buddy System (PRD §5).
 *
 * One new member, one search, one outstanding ask at a time. The whole design
 * turns on that last constraint: a co-op that emails six people at once gets
 * one buddy and five people who learn their answer did not matter.
 *
 * **Emails are sent after the transaction commits, never inside it.** A
 * Postmark call inside an interactive transaction holds the only connection
 * `connection_limit=1` allows for as long as the network takes (OPS-24), and
 * a send that fails must not roll back the ask it was announcing — the ask is
 * recorded, and a missing email is recoverable in a way a lost invitation is
 * not.
 */
@Injectable()
export class BuddyService {
  private readonly logger = new Logger(BuddyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BelongingSettingsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** The token lives in the email; only its hash lives in the database. */
  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private webUrl(): string {
    return this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  }

  // ─── Starting a search ──────────────────────────────────────

  /**
   * A new member arrived (PRD §5.1 step 1, §8.1).
   *
   * Silent when the tool is off: no pairing row, no email, nothing. "Off"
   * has to mean off, or a co-op that tries the feature and turns it back on
   * later discovers a backlog of pairings nobody asked for.
   */
  async onMemberJoined(orgId: string, memberId: string): Promise<string | null> {
    const settings = await this.settings.forOrg(orgId);
    if (!settings.buddySystemEnabled) return null;

    // A member already being matched, or already matched, is not matched
    // again. Re-running a join (a retried webhook, a re-accepted invite)
    // must not start a second search for the same person.
    const existing = await this.prisma.buddyPairing.findFirst({
      where: { orgId, newMemberId: memberId, state: { in: ['SEEKING', 'ACTIVE', 'NEEDS_ADMIN'] } },
      select: { id: true },
    });
    if (existing) return existing.id;

    const pairing = await this.prisma.buddyPairing.create({
      data: { orgId, newMemberId: memberId },
      select: { id: true },
    });

    await this.advance(pairing.id);
    return pairing.id;
  }

  // ─── Advancing to the next candidate ────────────────────────

  /**
   * Ask the next person, or give up and tell an admin (PRD §5.1 steps 2–8).
   *
   * Safe to call repeatedly. The scheduler, a decline, and an admin pressing
   * "look again" all land here, and an outstanding invitation makes every one
   * of them a no-op — which is what keeps "only one invitation outstanding
   * per pairing" true without a lock.
   */
  async advance(pairingId: string): Promise<AdvanceOutcome> {
    const pairing = await this.prisma.buddyPairing.findUnique({
      where: { id: pairingId },
      include: { newMember: { include: { user: { select: { name: true, email: true } } } }, org: true },
    });
    if (!pairing) throw new NotFoundException('Pairing not found');
    if (pairing.state !== 'SEEKING' && pairing.state !== 'NEEDS_ADMIN') {
      return { outcome: 'not-seeking' };
    }

    const pending = await this.prisma.buddyInvitation.findFirst({
      where: { pairingId, state: 'PENDING' },
      select: { id: true },
    });
    if (pending) return { outcome: 'already-pending' };

    const settings = await this.settings.forOrg(pairing.orgId);
    const pool = await this.eligiblePool(pairing.orgId, pairing.newMemberId);

    const { candidate, relaxedCooldowns } = selectCandidate(pool, {
      maxActivePairings: settings.buddyMaxActivePairings,
      askCooldownDays: settings.buddyAskCooldownDays,
      serveCooldownDays: settings.buddyServeCooldownDays,
    });

    if (!candidate) {
      const fallback = await this.settings.fallbackAdmin(pairing.orgId);
      await this.prisma.buddyPairing.update({
        where: { id: pairingId },
        data: { state: 'NEEDS_ADMIN' },
      });
      this.logger.log(`Pairing ${pairingId} exhausted its pool; offered to admin`);
      return { outcome: 'needs-admin', fallbackId: fallback?.id ?? null };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + settings.buddyInviteTimeoutHours * 3600 * 1000);

    // The ask and its bookkeeping commit together. §5.2's "every ask writes
    // to the log whether or not it is answered" is only true if the counter
    // and the invitation cannot disagree.
    const invitation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.buddyInvitation.create({
        data: {
          pairingId,
          candidateId: candidate.memberId,
          tokenHash: BuddyService.hash(token),
          expiresAt,
        },
        select: { id: true },
      });

      await tx.memberBuddyStats.upsert({
        where: { memberId: candidate.memberId },
        create: { memberId: candidate.memberId, timesAsked: 1, lastAskedAt: new Date() },
        update: { timesAsked: { increment: 1 }, lastAskedAt: new Date() },
      });

      return created;
    });

    if (relaxedCooldowns) {
      // Not an error, but the co-op's early warning that the same few people
      // are carrying this.
      this.logger.log(`Pairing ${pairingId} had to relax its cooldowns to find anyone`);
    }

    await this.sendInvitation(pairing.orgId, candidate.memberId, {
      newMemberName: pairing.newMember.user.name ?? 'A new member',
      communityName: pairing.org.name,
      token,
      timeoutHours: settings.buddyInviteTimeoutHours,
    });

    return {
      outcome: 'invited',
      invitationId: invitation.id,
      candidateId: candidate.memberId,
      relaxedCooldowns,
    };
  }

  /**
   * Everyone who could be asked, with the rotation facts about each.
   *
   * GUEST is excluded along with the new member themselves: a guest is not a
   * member, and asking one to induct somebody would be introducing a new
   * member to someone with less standing than they have.
   */
  private async eligiblePool(orgId: string, newMemberId: string): Promise<BuddyCandidate[]> {
    const members = await this.prisma.userOrg.findMany({
      where: { orgId, role: { in: ['ADMIN', 'STAFF', 'MEMBER'] }, id: { not: newMemberId } },
      select: {
        id: true,
        buddyStats: true,
        _count: {
          select: {
            buddyPairingsAsBuddy: { where: { state: 'ACTIVE' } },
            buddyInvitations: { where: { state: 'PENDING' } },
          },
        },
      },
    });

    return members.map((m) => ({
      memberId: m.id,
      timesServed: m.buddyStats?.timesServed ?? 0,
      timesAsked: m.buddyStats?.timesAsked ?? 0,
      lastAskedAt: m.buddyStats?.lastAskedAt ?? null,
      lastServedAt: m.buddyStats?.lastServedAt ?? null,
      optedOut: m.buddyStats?.optedOut ?? false,
      activePairings: m._count.buddyPairingsAsBuddy,
      hasOutstandingInvitation: m._count.buddyInvitations > 0,
    }));
  }

  // ─── Answering ──────────────────────────────────────────────

  /**
   * Accept or decline, from a link in an email (PRD §5.1 steps 4–5).
   *
   * No login. The token is the authorisation, which is why it is long, single
   * use, and stored only as a hash — and why a token that no longer matches a
   * pending invitation is answered with "this one is already covered" rather
   * than an error. A member clicking a stale link did nothing wrong.
   */
  async respond(token: string, answer: 'accept' | 'decline') {
    const invitation = await this.prisma.buddyInvitation.findUnique({
      where: { tokenHash: BuddyService.hash(token) },
      include: {
        pairing: {
          include: {
            org: true,
            newMember: { include: { user: { select: { name: true, email: true } } } },
          },
        },
        candidate: { include: { user: { select: { name: true, email: true } } } },
      },
    });

    if (!invitation) return { status: 'unknown' as const };
    if (invitation.state !== 'PENDING' || invitation.pairing.state !== 'SEEKING') {
      return { status: 'already-covered' as const };
    }

    if (answer === 'decline') {
      await this.prisma.buddyInvitation.update({
        where: { id: invitation.id },
        data: { state: 'DECLINED', respondedAt: new Date() },
      });
      // Immediately, not on the next scheduler pass: a declined ask that sits
      // for an hour is an hour a new member spends unmatched for no reason.
      await this.advance(invitation.pairingId);
      return { status: 'declined' as const, communityName: invitation.pairing.org.name };
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.buddyInvitation.update({
        where: { id: invitation.id },
        data: { state: 'ACCEPTED', respondedAt: now },
      });
      await tx.buddyPairing.update({
        where: { id: invitation.pairingId },
        data: { state: 'ACTIVE', buddyMemberId: invitation.candidateId, resolvedAt: now },
      });
      await tx.memberBuddyStats.upsert({
        where: { memberId: invitation.candidateId },
        create: { memberId: invitation.candidateId, timesServed: 1, lastServedAt: now },
        update: { timesServed: { increment: 1 }, lastServedAt: now },
      });
    });

    await this.sendIntroductions(invitation.pairing.orgId, {
      buddy: invitation.candidate,
      newMember: invitation.pairing.newMember,
      communityName: invitation.pairing.org.name,
      orgSlug: invitation.pairing.org.slug,
    });

    return { status: 'accepted' as const, communityName: invitation.pairing.org.name };
  }

  // ─── The hourly sweep ───────────────────────────────────────

  /**
   * Expire timed-out asks, let people off the hook, move on (PRD §5.1 step 6,
   * §7, §8.3).
   *
   * Three separate passes rather than one loop, and the order is the
   * acceptance criterion: **an expired invitation always produces an Off the
   * Hook email before the next candidate is asked.** Somebody who did not
   * answer should hear "nothing is owed" before they hear nothing at all,
   * and certainly before they find out second-hand that someone else was
   * asked.
   *
   * Every pass is idempotent and each is safe to resume after a crash in the
   * middle of the previous one. That is why expiring and emailing are
   * separate: a process that died between them leaves an EXPIRED invitation
   * with no `offTheHookSentAt`, which the next run finishes rather than
   * skipping.
   */
  async runDueWork(now: Date = new Date()): Promise<{
    expired: number;
    offTheHookSent: number;
    advanced: number;
  }> {
    // 1. Expire. Conditional on PENDING, so an accept landing in the same
    //    second wins and is not overwritten by the sweep.
    const overdue = await this.prisma.buddyInvitation.findMany({
      where: { state: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });

    let expired = 0;
    for (const invitation of overdue) {
      const claimed = await this.prisma.buddyInvitation.updateMany({
        where: { id: invitation.id, state: 'PENDING' },
        data: { state: 'EXPIRED' },
      });
      expired += claimed.count;
    }

    // 2. Off the hook, before anybody else is asked.
    const owed = await this.prisma.buddyInvitation.findMany({
      where: { state: 'EXPIRED', offTheHookSentAt: null },
      include: {
        candidate: { select: { user: { select: { email: true } } } },
        pairing: {
          include: {
            org: { select: { id: true, name: true, slug: true } },
            newMember: { select: { user: { select: { name: true } } } },
          },
        },
      },
    });

    let offTheHookSent = 0;
    for (const invitation of owed) {
      try {
        await this.sendRendered(
          invitation.pairing.orgId,
          'OFF_THE_HOOK',
          invitation.candidate.user.email,
          {
            new_member_name: invitation.pairing.newMember.user.name ?? 'a new member',
            community_name: invitation.pairing.org.name,
            opt_out_url: `${this.webUrl()}/portal/${invitation.pairing.org.slug}/profile#buddy`,
          },
        );
        // Stamped after the send returns. Sends are fire-and-forget, so a
        // failure is logged rather than thrown and there is nothing better
        // to condition on — but a crash before this line means the next run
        // tries again, which is the direction to fail in.
        await this.prisma.buddyInvitation.update({
          where: { id: invitation.id },
          data: { offTheHookSentAt: new Date() },
        });
        offTheHookSent += 1;
      } catch (err) {
        this.logger.error(
          `Could not release ${invitation.candidateId} from pairing ${invitation.pairingId}: ${(err as Error).message}`,
        );
      }
    }

    // 3. Ask somebody else. Any pairing still seeking with nothing
    //    outstanding, which also quietly heals a pairing stranded by an
    //    earlier failure rather than leaving it stuck forever.
    const stalled = await this.prisma.buddyPairing.findMany({
      where: {
        state: 'SEEKING',
        org: { belongingSettings: { buddySystemEnabled: true } },
        invitations: { none: { state: 'PENDING' } },
      },
      select: { id: true },
    });

    let advanced = 0;
    for (const pairing of stalled) {
      try {
        const result = await this.advance(pairing.id);
        if (result.outcome === 'invited' || result.outcome === 'needs-admin') advanced += 1;
      } catch (err) {
        this.logger.error(`Could not advance pairing ${pairing.id}: ${(err as Error).message}`);
      }
    }

    return { expired, offTheHookSent, advanced };
  }

  // ─── Emails ─────────────────────────────────────────────────

  /** The co-op's own wording if it has written any, otherwise the default. */
  private async templateFor(orgId: string, kind: BelongingEmailKindName) {
    const custom = await this.prisma.belongingEmailTemplate.findUnique({
      where: { orgId_kind: { orgId, kind } },
    });
    return custom ?? DEFAULT_TEMPLATES[kind];
  }

  private async sendRendered(
    orgId: string,
    kind: BelongingEmailKindName,
    to: string,
    values: Record<string, string | null>,
  ) {
    const template = await this.templateFor(orgId, kind);
    const { subject, html } = renderTemplate(template, values);
    await this.email.sendRaw(to, subject, html);
  }

  private async sendInvitation(
    orgId: string,
    candidateId: string,
    d: { newMemberName: string; communityName: string; token: string; timeoutHours: number },
  ) {
    const candidate = await this.prisma.userOrg.findUnique({
      where: { id: candidateId },
      select: { user: { select: { email: true } } },
    });
    if (!candidate) return;

    await this.sendRendered(orgId, 'BUDDY_INVITATION', candidate.user.email, {
      new_member_name: d.newMemberName,
      community_name: d.communityName,
      accept_url: `${this.webUrl()}/buddy/${d.token}?answer=accept`,
      decline_url: `${this.webUrl()}/buddy/${d.token}?answer=decline`,
      timeout_hours: String(d.timeoutHours),
    });
  }

  /**
   * Both intros, each pointing at the same conversation (PRD §5.3).
   *
   * One CTA each, and it is the DM thread, because sending the first message
   * is the only thing that makes a pairing real.
   */
  private async sendIntroductions(
    orgId: string,
    d: {
      buddy: { userId: string; user: { name: string | null; email: string } };
      newMember: { userId: string; user: { name: string | null; email: string } };
      communityName: string;
      orgSlug: string;
    },
  ) {
    const buddyName = d.buddy.user.name ?? 'Your buddy';
    const newMemberName = d.newMember.user.name ?? 'Your new member';
    // Each person's link names the *other* person, so both land in the same
    // conversation rather than on a list of conversations. The success action
    // is sending a message, and every extra click before the composer is a
    // chance to not send it.
    const threadWith = (userId: string) =>
      `${this.webUrl()}/portal/${d.orgSlug}/messages/${userId}`;

    await this.sendRendered(orgId, 'INTRO_TO_BUDDY', d.buddy.user.email, {
      new_member_name: newMemberName,
      buddy_name: buddyName,
      community_name: d.communityName,
      dm_url: threadWith(d.newMember.userId),
    });

    await this.sendRendered(orgId, 'INTRO_TO_NEW_MEMBER', d.newMember.user.email, {
      new_member_name: newMemberName,
      buddy_name: buddyName,
      community_name: d.communityName,
      dm_url: threadWith(d.buddy.userId),
    });
  }
}
