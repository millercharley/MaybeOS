import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/** Roles that count as a member of the community. GUEST is not one. */
const MEMBER_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

/**
 * The two things a screen wants to know the moment it opens: how the co-op is
 * doing, and what is happening right now.
 *
 * Kept together because they share the same shape of query — a count and a
 * window — and apart from `OrgService` because that is about configuring a
 * co-op rather than watching one.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Membership, with the change worth showing beside it.
   *
   * **Joins, not net growth.** Removing a membership deletes the row, so
   * MaybeOS has no record of departures and cannot honestly compute a net
   * figure. What is returned is what can be defended: how many people joined
   * since the start of the month.
   */
  async memberStats(orgId: string, now: Date = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [total, joinedThisMonth] = await Promise.all([
      this.prisma.userOrg.count({ where: { orgId, role: { in: [...MEMBER_ROLES] } } }),
      this.prisma.userOrg.count({
        where: { orgId, role: { in: [...MEMBER_ROLES] }, memberSince: { gte: monthStart } },
      }),
    ]);

    return { total, joinedThisMonth, since: monthStart };
  }

  /**
   * People who joined recently, for the Commons welcome card (delight #4).
   *
   * **Derived, not stored.** A welcome card could have been a real Post
   * authored by the system, but a post is a thing in a channel forever: it
   * cannot age out, it pushes real conversation down, and deleting it is a
   * moderation decision somebody has to make about a message nobody wrote.
   * Reading it off `memberSince` means the card appears when somebody joins,
   * disappears a week later, and leaves nothing behind.
   *
   * Excludes the viewer, because being welcomed to your own arrival is a
   * small indignity and the "say hi" button would open a conversation with
   * yourself.
   */
  async recentJoins(orgId: string, viewerUserId: string, now: Date = new Date()) {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const joins = await this.prisma.userOrg.findMany({
      where: {
        orgId,
        role: { in: [...MEMBER_ROLES] },
        memberSince: { gte: since },
        userId: { not: viewerUserId },
      },
      orderBy: { memberSince: 'desc' },
      // Three at most. A co-op that imported four hundred members should not
      // get four hundred welcome cards, and even a real week of arrivals is
      // better as "and four others" than as a wall.
      take: 4,
      select: {
        id: true,
        memberSince: true,
        headline: true,
        user: { select: { id: true, name: true, avatarPath: true } },
      },
    });

    return {
      members: joins.slice(0, 3).map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        avatarPath: m.user.avatarPath,
        headline: m.headline,
        joinedAt: m.memberSince,
      })),
      more: Math.max(joins.length - 3, 0),
    };
  }

  /**
   * What is going on in the building, right now (delight #2).
   *
   * For a physical space this is the highest-value thing on a screen, and the
   * reason is that it answers a question a member actually has standing in
   * the doorway: *is anyone here?* Everything else on a dashboard is a
   * question they only have sitting down.
   *
   * Three windows, deliberately different:
   *
   * - **Checked in** is *now* — people at an event that has started and not
   *   ended. Not "checked in today", which would still show this morning's
   *   crowd at 9pm.
   * - **Rooms** is *now* — a booking is interesting while it is happening.
   * - **Starting soon** is the next two hours, because that is the horizon on
   *   which somebody might change their afternoon.
   */
  async happeningNow(orgId: string, now: Date = new Date()) {
    const soon = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const [liveEvents, bookings, startingSoon] = await Promise.all([
      // Events under way. Their check-ins are who is actually here.
      this.prisma.event.findMany({
        where: { orgId, startTime: { lte: now }, endTime: { gte: now } },
        select: {
          id: true,
          title: true,
          endTime: true,
          rsvps: {
            where: { checkedIn: true, userId: { not: null } },
            select: {
              checkedInAt: true,
              user: { select: { id: true, name: true, avatarPath: true } },
            },
            orderBy: { checkedInAt: 'desc' },
            take: 12,
          },
        },
      }),

      this.prisma.booking.findMany({
        where: {
          room: { orgId },
          // APPROVED is the only state a booking is actually held in;
          // PENDING is still awaiting an organiser and must not read as
          // "this room is in use".
          status: 'APPROVED',
          startTime: { lte: now },
          endTime: { gte: now },
        },
        select: {
          id: true,
          title: true,
          endTime: true,
          room: { select: { id: true, name: true } },
          user: { select: { name: true } },
        },
        orderBy: { endTime: 'asc' },
      }),

      this.prisma.event.findMany({
        where: { orgId, isPublished: true, startTime: { gt: now, lte: soon } },
        select: {
          id: true,
          title: true,
          slug: true,
          startTime: true,
          location: { select: { name: true } },
          room: { select: { name: true } },
          _count: { select: { rsvps: true } },
        },
        orderBy: { startTime: 'asc' },
        take: 5,
      }),
    ]);

    const checkedIn = liveEvents.flatMap((e) =>
      e.rsvps.map((r) => ({
        eventId: e.id,
        eventTitle: e.title,
        checkedInAt: r.checkedInAt,
        user: r.user,
      })),
    );

    return {
      checkedIn,
      // The count is separate from the list because the list is capped at
      // twelve faces — a room of forty should not read as a room of twelve.
      checkedInCount: checkedIn.length,
      rooms: bookings.map((b) => ({
        id: b.id,
        roomName: b.room.name,
        title: b.title,
        until: b.endTime,
        who: b.user?.name ?? null,
      })),
      startingSoon: startingSoon.map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        startTime: e.startTime,
        // A room inside the building is more useful than the building's
        // own name to somebody already standing in it.
        where: e.room?.name ?? e.location?.name ?? null,
        rsvpCount: e._count.rsvps,
      })),
      /** So a client can say "as of a minute ago" rather than implying live. */
      asOf: now,
    };
  }
}
