import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BuddyService } from './buddy.service';

/** Days after pairing with no message before the log says so. */
const SILENT_AFTER_DAYS = 14;

/**
 * What an admin can see about the rotation (PRD §5.5).
 *
 * The log exists so a co-op can tell whether the Buddy System is working,
 * and "working" is not "pairs exist". It is **whether anybody said
 * anything.** So the active-pairs view carries whether a message has been
 * exchanged, and flags a pair that has been silent for a fortnight — the
 * failure mode here is not a stale record, it is a new member assigned
 * somebody who never wrote to them and nobody noticing.
 *
 * **Nothing here is visible to the new member**, and in particular no view
 * exposes who declined (§9, Charley's answer: no, never). A community where
 * people can see who did not want to welcome them is worse than one with no
 * buddy system at all.
 */
@Injectable()
export class BuddyLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly buddies: BuddyService,
  ) {}

  private async ownedPairing(orgId: string, pairingId: string) {
    const pairing = await this.prisma.buddyPairing.findFirst({
      where: { id: pairingId, orgId },
      select: { id: true, state: true, newMemberId: true, buddyMemberId: true },
    });
    if (!pairing) throw new NotFoundException('Pairing not found');
    return pairing;
  }

  /** Active pairs: who, with whom, since when, and whether they have spoken. */
  async pairings(orgId: string) {
    const pairings = await this.prisma.buddyPairing.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        newMember: { select: { id: true, userId: true, user: { select: { name: true } } } },
        buddyMember: { select: { id: true, userId: true, user: { select: { name: true } } } },
        _count: { select: { invitations: true } },
      },
    });

    // One query for every conversation rather than one per pair.
    const userPairs = pairings
      .filter((p) => p.buddyMember)
      .map((p) => ({ a: p.newMember.userId, b: p.buddyMember!.userId }));

    const messages = userPairs.length
      ? await this.prisma.directMessage.findMany({
          where: {
            orgId,
            OR: userPairs.flatMap(({ a, b }) => [
              { senderId: a, receiverId: b },
              { senderId: b, receiverId: a },
            ]),
          },
          select: { senderId: true, receiverId: true, createdAt: true },
        })
      : [];

    const spokeAt = new Map<string, Date>();
    for (const m of messages) {
      const key = [m.senderId, m.receiverId].sort().join('|');
      const seen = spokeAt.get(key);
      if (!seen || m.createdAt < seen) spokeAt.set(key, m.createdAt);
    }

    const now = Date.now();
    return pairings.map((p) => {
      const key = p.buddyMember
        ? [p.newMember.userId, p.buddyMember.userId].sort().join('|')
        : null;
      const firstMessageAt = key ? (spokeAt.get(key) ?? null) : null;
      const silentDays = Math.floor((now - p.createdAt.getTime()) / 86400000);

      return {
        id: p.id,
        state: p.state,
        newMember: { id: p.newMember.id, name: p.newMember.user.name },
        buddy: p.buddyMember ? { id: p.buddyMember.id, name: p.buddyMember.user.name } : null,
        pairedAt: p.resolvedAt,
        createdAt: p.createdAt,
        timesAsked: p._count.invitations,
        messageExchanged: firstMessageAt !== null,
        firstMessageAt,
        // The signal worth acting on: a pair that exists and has never
        // spoken. An introduction nobody followed up on is the failure this
        // whole tool is meant to prevent.
        silent: p.state === 'ACTIVE' && firstMessageAt === null && silentDays >= SILENT_AFTER_DAYS,
      };
    });
  }

  /** Every ask, answered or not — which is what makes rotation auditable. */
  async invitations(orgId: string) {
    const rows = await this.prisma.buddyInvitation.findMany({
      where: { pairing: { orgId } },
      orderBy: { sentAt: 'desc' },
      take: 500,
      include: {
        candidate: { select: { id: true, user: { select: { name: true } } } },
        pairing: { select: { id: true, newMember: { select: { user: { select: { name: true } } } } } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      pairingId: r.pairingId,
      candidate: { id: r.candidate.id, name: r.candidate.user.name },
      newMember: r.pairing.newMember.user.name,
      state: r.state,
      sentAt: r.sentAt,
      expiresAt: r.expiresAt,
      respondedAt: r.respondedAt,
      offTheHookSentAt: r.offTheHookSentAt,
    }));
  }

  /** Per member: asked, served, when, and whether they opted out. */
  async memberSummary(orgId: string) {
    const members = await this.prisma.userOrg.findMany({
      where: { orgId, role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } },
      select: {
        id: true,
        user: { select: { name: true } },
        buddyStats: true,
        _count: { select: { buddyPairingsAsBuddy: { where: { state: 'ACTIVE' } } } },
      },
    });

    return members
      .map((m) => ({
        memberId: m.id,
        name: m.user.name,
        timesAsked: m.buddyStats?.timesAsked ?? 0,
        timesServed: m.buddyStats?.timesServed ?? 0,
        lastAskedAt: m.buddyStats?.lastAskedAt ?? null,
        lastServedAt: m.buddyStats?.lastServedAt ?? null,
        optedOut: m.buddyStats?.optedOut ?? false,
        activePairings: m._count.buddyPairingsAsBuddy,
      }))
      // Same order the rotation itself uses, so the list reads as the queue
      // it actually is rather than as an alphabetical roster.
      .sort((a, b) => a.timesServed - b.timesServed || a.timesAsked - b.timesAsked);
  }

  /** What one member sees about their own pairing. */
  async forMember(orgId: string, memberId: string) {
    const [stats, asBuddy, asNewMember] = await Promise.all([
      this.prisma.memberBuddyStats.findUnique({ where: { memberId } }),
      this.prisma.buddyPairing.findFirst({
        where: { orgId, buddyMemberId: memberId, state: 'ACTIVE' },
        include: { newMember: { select: { userId: true, user: { select: { name: true } } } } },
      }),
      this.prisma.buddyPairing.findFirst({
        where: { orgId, newMemberId: memberId, state: 'ACTIVE' },
        include: { buddyMember: { select: { userId: true, user: { select: { name: true } } } } },
      }),
    ]);

    return {
      optedOut: stats?.optedOut ?? false,
      timesServed: stats?.timesServed ?? 0,
      // Deliberately no invitation history and no declines: a member's own
      // view is about who they are paired with, never about who said no.
      buddyingFor: asBuddy
        ? { pairingId: asBuddy.id, userId: asBuddy.newMember.userId, name: asBuddy.newMember.user.name }
        : null,
      myBuddy: asNewMember?.buddyMember
        ? {
            pairingId: asNewMember.id,
            userId: asNewMember.buddyMember.userId,
            name: asNewMember.buddyMember.user.name,
          }
        : null,
    };
  }

  /**
   * The prompts a buddy sees above the composer, in one conversation
   * (PRD §5.4).
   *
   * **Whether the viewer is that person's buddy is decided here, not in the
   * UI.** "The new member never sees these" is a promise about what a co-op's
   * coaching looks like from the inside — somebody discovering that their
   * welcome was scripted would learn something the co-op did not choose to
   * tell them — and a promise kept only by a component that hides a list is
   * one browser devtools panel from being broken.
   *
   * Empty for everybody else, including admins looking at their own threads.
   */
  async suggestionsForThread(orgId: string, viewerId: string, otherUserId: string) {
    const pairing = await this.prisma.buddyPairing.findFirst({
      where: {
        orgId,
        state: 'ACTIVE',
        buddyMemberId: viewerId,
        newMember: { userId: otherUserId },
      },
      select: { id: true },
    });
    if (!pairing) return { pairingId: null, suggestions: [] };

    const suggestions = await this.prisma.buddySuggestion.findMany({
      where: {
        orgId,
        active: true,
        // Dismissals are per member per suggestion, so one buddy tidying
        // their own composer does not take the prompt away from anybody else.
        dismissals: { none: { memberId: viewerId } },
      },
      orderBy: { position: 'asc' },
      select: { id: true, body: true },
    });

    return { pairingId: pairing.id, suggestions };
  }

  // ─── Admin actions ──────────────────────────────────────────

  async reassign(orgId: string, pairingId: string, buddyMemberId: string) {
    await this.ownedPairing(orgId, pairingId);

    const buddy = await this.prisma.userOrg.findFirst({
      where: { id: buddyMemberId, orgId },
      select: { id: true },
    });
    if (!buddy) throw new NotFoundException('That member is not in this community');

    return this.prisma.$transaction(async (tx) => {
      // Any ask still outstanding is superseded rather than left pending, so
      // somebody cannot accept a pairing an admin has already resolved.
      await tx.buddyInvitation.updateMany({
        where: { pairingId, state: 'PENDING' },
        data: { state: 'SUPERSEDED' },
      });
      return tx.buddyPairing.update({
        where: { id: pairingId },
        data: { state: 'ACTIVE', buddyMemberId, resolvedAt: new Date() },
      });
    });
  }

  async close(orgId: string, pairingId: string, closedByUserId: string, reason?: string) {
    await this.ownedPairing(orgId, pairingId);

    return this.prisma.$transaction(async (tx) => {
      await tx.buddyInvitation.updateMany({
        where: { pairingId, state: 'PENDING' },
        data: { state: 'SUPERSEDED' },
      });
      return tx.buddyPairing.update({
        where: { id: pairingId },
        data: {
          state: 'CLOSED',
          closedById: closedByUserId,
          closeReason: reason ?? null,
          resolvedAt: new Date(),
        },
      });
    });
  }

  /** Start looking again — for a pairing that stalled or was reopened. */
  async searchAgain(orgId: string, pairingId: string) {
    const pairing = await this.ownedPairing(orgId, pairingId);

    if (pairing.state === 'ACTIVE' || pairing.state === 'CLOSED') {
      await this.prisma.buddyPairing.update({
        where: { id: pairingId },
        data: { state: 'SEEKING', buddyMemberId: null, resolvedAt: null },
      });
    }
    return this.buddies.advance(pairingId);
  }

  // ─── CSV (§5.5) ─────────────────────────────────────────────

  /**
   * The same three views, as a file.
   *
   * Every field is quoted and internal quotes are doubled — a member called
   * O'Brien is fine, but a co-op whose article title contains a comma should
   * not silently shift every column after it.
   */
  async csv(orgId: string, view: 'pairings' | 'invitations' | 'members'): Promise<string> {
    const cell = (value: unknown): string => {
      if (value === null || value === undefined) return '""';
      const text = value instanceof Date ? value.toISOString() : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const line = (values: unknown[]) => values.map(cell).join(',');

    if (view === 'invitations') {
      const rows = await this.invitations(orgId);
      return [
        line(['Candidate', 'New member', 'State', 'Sent at', 'Expires at', 'Responded at', 'Released at']),
        ...rows.map((r) =>
          line([r.candidate.name, r.newMember, r.state, r.sentAt, r.expiresAt, r.respondedAt, r.offTheHookSentAt]),
        ),
      ].join('\n');
    }

    if (view === 'members') {
      const rows = await this.memberSummary(orgId);
      return [
        line(['Member', 'Times asked', 'Times served', 'Last asked', 'Last served', 'Opted out', 'Active pairings']),
        ...rows.map((r) =>
          line([r.name, r.timesAsked, r.timesServed, r.lastAskedAt, r.lastServedAt, r.optedOut, r.activePairings]),
        ),
      ].join('\n');
    }

    const rows = await this.pairings(orgId);
    return [
      line(['New member', 'Buddy', 'State', 'Paired at', 'Times asked', 'Message exchanged', 'Silent']),
      ...rows.map((r) =>
        line([r.newMember.name, r.buddy?.name, r.state, r.pairedAt, r.timesAsked, r.messageExchanged, r.silent]),
      ),
    ].join('\n');
  }
}
