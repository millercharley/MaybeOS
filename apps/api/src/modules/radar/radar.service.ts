import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { encodeUnsubscribe } from '../../common/unsubscribe-token';
import { zonedParts } from '../space/availability/zoned-time';
import { STARTER_INTERESTS } from './interest-starters';
import { assertRadarAvailable, radarAvailable } from './radar-availability';
import { InterestStanding, rankMatches } from './radar-match';
import {
  INTERESTS_PER_ASK,
  InterestAskState,
  afterAnswer,
  afterDismissal,
  canAskInterests,
} from './interest-ask';

/**
 * How far ahead the digest looks. Six weeks is far enough that a member hears
 * about the thing worth putting in a diary, and near enough that they have not
 * forgotten by the time it happens.
 */
const HORIZON_DAYS = 42;

/** At most five gatherings in one email. A list nobody finishes is a list. */
const MAX_PER_DIGEST = 5;

/**
 * A member is sent at most one digest a week. The scheduler runs every
 * fifteen minutes, so this is what makes "the Thursday email" a thing that
 * happens once rather than four times an hour.
 */
const MIN_DAYS_BETWEEN_DIGESTS = 6;

/** Members handled per run. A co-op of any size gets through in a few runs. */
const BATCH = 200;

export interface RadarRunResult {
  processed: number;
  failed: number;
  errors: string[];
}

/**
 * Radar (RDR-01): telling a member about the gatherings they would want to
 * know about, and nothing else.
 *
 * The whole feature turns on two things being true at once — MaybeOS knowing
 * what somebody is interested in, and a host having said what their gathering
 * is. Neither is worth much alone, which is why the interest list is one list,
 * shared by both halves: the words a member picks from are the words a host
 * tags with.
 */
@Injectable()
export class RadarService {
  private readonly logger = new Logger(RadarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------
  // The co-op's list
  // ---------------------------------------------------------------------

  /**
   * The co-op's interests, seeded on first read.
   *
   * Seeding here rather than at org creation means a co-op that never turns
   * Radar on never gets the rows, and one that does never sees an empty box.
   * `createMany` with `skipDuplicates` makes a second caller harmless.
   */
  async tags(orgId: string, includeInactive = false) {
    const existing = await this.prisma.interestTag.count({ where: { orgId } });

    if (existing === 0) {
      await this.prisma.interestTag.createMany({
        data: STARTER_INTERESTS.map((interest, index) => ({
          orgId,
          name: interest.name,
          emoji: interest.emoji,
          sortOrder: index,
        })),
        skipDuplicates: true,
      });
    }

    return this.prisma.interestTag.findMany({
      where: { orgId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createTag(orgId: string, name: string, emoji?: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Give the interest a name.');

    const last = await this.prisma.interestTag.findFirst({
      where: { orgId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    try {
      return await this.prisma.interestTag.create({
        data: { orgId, name: clean, emoji: emoji?.trim() || null, sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(`"${clean}" is already on the list.`);
      }
      throw error;
    }
  }

  /**
   * Rename, re-emoji, activate or deactivate one interest.
   *
   * **A rename rewrites the word wherever it is already written on an event.**
   * Events carry the interest as text (EVT-20's `tags`), so without this an
   * admin tidying "Social" into "Social time" would quietly un-tag every
   * social event the co-op has ever run — the tag would still exist, the
   * events would still read "Social", and nothing would match either.
   */
  async updateTag(
    orgId: string,
    tagId: string,
    changes: { name?: string; emoji?: string | null; isActive?: boolean },
  ) {
    const tag = await this.prisma.interestTag.findFirst({ where: { id: tagId, orgId } });
    if (!tag) throw new NotFoundException('That interest is not on this community&rsquo;s list');

    const name = changes.name?.trim();
    if (changes.name !== undefined && !name) {
      throw new BadRequestException('Give the interest a name.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.interestTag.update({
        where: { id: tag.id },
        data: {
          ...(name && { name }),
          ...(changes.emoji !== undefined && { emoji: changes.emoji?.trim() || null }),
          ...(changes.isActive !== undefined && { isActive: changes.isActive }),
        },
      });

      if (name && name !== tag.name) {
        await tx.$executeRaw`
          UPDATE "events"
             SET "tags" = array_replace("tags", ${tag.name}, ${name}),
                 "category" = CASE WHEN "category" = ${tag.name} THEN ${name} ELSE "category" END
           WHERE "orgId" = ${orgId}
             AND (${tag.name} = ANY("tags") OR "category" = ${tag.name})
        `;
      }

      return updated;
    });
  }

  /**
   * Take an interest off the list.
   *
   * Deactivated rather than deleted when any event already carries it: a tag
   * nobody can choose any more still has to explain the gatherings that were
   * tagged with it, and deleting the row would also delete every member's
   * answer about it.
   */
  async removeTag(orgId: string, tagId: string) {
    const tag = await this.prisma.interestTag.findFirst({ where: { id: tagId, orgId } });
    if (!tag) throw new NotFoundException('That interest is not on this community&rsquo;s list');

    const inUse = await this.prisma.event.count({ where: { orgId, tags: { has: tag.name } } });
    const answered = await this.prisma.memberInterest.count({ where: { tagId: tag.id } });

    if (inUse > 0 || answered > 0) {
      return this.prisma.interestTag.update({ where: { id: tag.id }, data: { isActive: false } });
    }

    await this.prisma.interestTag.delete({ where: { id: tag.id } });
    return null;
  }

  // ---------------------------------------------------------------------
  // The switch
  // ---------------------------------------------------------------------

  async settings(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, radarEnabled: true, radarDigestDay: true, radarDigestHour: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    const [tags, subscribed, withInterests] = await Promise.all([
      this.tags(orgId, true),
      this.prisma.userOrg.count({ where: { orgId, radarEmails: true } }),
      this.prisma.userOrg.count({ where: { orgId, interests: { some: { declared: true } } } }),
    ]);

    return {
      available: radarAvailable(org.plan),
      plan: org.plan,
      enabled: org.radarEnabled,
      digestDay: org.radarDigestDay,
      digestHour: org.radarDigestHour,
      tags,
      // Counts, never names: an admin may know how many members have said
      // what they like, and never which member said what.
      subscribed,
      withInterests,
    };
  }

  async updateSettings(
    orgId: string,
    changes: { enabled?: boolean; digestDay?: number; digestHour?: number },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    // Only switching it *on* is gated. A co-op that drops to Free can still
    // turn Radar off, and its settings stay where they are.
    if (changes.enabled === true) assertRadarAvailable(org.plan);

    if (changes.digestDay !== undefined && (changes.digestDay < 0 || changes.digestDay > 6)) {
      throw new BadRequestException('Pick a day of the week.');
    }
    if (changes.digestHour !== undefined && (changes.digestHour < 0 || changes.digestHour > 23)) {
      throw new BadRequestException('Pick an hour of the day.');
    }

    if (changes.enabled) await this.tags(orgId);

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(changes.enabled !== undefined && { radarEnabled: changes.enabled }),
        ...(changes.digestDay !== undefined && { radarDigestDay: changes.digestDay }),
        ...(changes.digestHour !== undefined && { radarDigestHour: changes.digestHour }),
      },
    });

    return this.settings(orgId);
  }

  // ---------------------------------------------------------------------
  // What one member is interested in
  // ---------------------------------------------------------------------

  private async membership(orgId: string, userId: string) {
    const found = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: {
        id: true,
        radarEmails: true,
        interestsAskedAt: true,
        interestsDismissals: true,
      },
    });
    if (!found) throw new NotFoundException('You are not a member of this community');
    return found;
  }

  /**
   * Everything MaybeOS thinks about this member's interests, including what it
   * inferred — shown to them in the same list and in the same words as what
   * they chose. A member can always see the guess, and always overrule it.
   */
  async myInterests(orgId: string, userId: string) {
    const membership = await this.membership(orgId, userId);
    const [tags, standings] = await Promise.all([
      this.tags(orgId),
      this.prisma.memberInterest.findMany({ where: { userOrgId: membership.id } }),
    ]);

    const byTag = new Map(standings.map((standing) => [standing.tagId, standing]));

    return {
      radarEmails: membership.radarEmails,
      interests: tags.map((tag) => ({
        tagId: tag.id,
        name: tag.name,
        emoji: tag.emoji,
        declared: byTag.get(tag.id)?.declared ?? null,
        rsvpCount: byTag.get(tag.id)?.rsvpCount ?? 0,
      })),
    };
  }

  /** The member's own answers. Answering anything clears the ask cadence. */
  async setInterests(
    orgId: string,
    userId: string,
    answers: { tagId: string; declared: boolean | null }[],
  ) {
    const membership = await this.membership(orgId, userId);
    const tags = await this.prisma.interestTag.findMany({
      where: { orgId, id: { in: answers.map((a) => a.tagId) } },
      select: { id: true },
    });
    const known = new Set(tags.map((tag) => tag.id));

    for (const answer of answers) {
      if (!known.has(answer.tagId)) {
        throw new BadRequestException('That interest is not on this community&rsquo;s list');
      }
    }

    await this.prisma.$transaction([
      ...answers.map((answer) =>
        this.prisma.memberInterest.upsert({
          where: { userOrgId_tagId: { userOrgId: membership.id, tagId: answer.tagId } },
          create: { userOrgId: membership.id, tagId: answer.tagId, declared: answer.declared },
          update: { declared: answer.declared },
        }),
      ),
      this.prisma.userOrg.update({ where: { id: membership.id }, data: afterAnswer() }),
    ]);

    return this.myInterests(orgId, userId);
  }

  /**
   * The next few interests to put in front of this member, or null.
   *
   * Offers the ones they have never answered, preferring interests their
   * co-op actually runs gatherings about — asking somebody whether they like
   * rehearsals in a co-op that has never held one spends the question badly.
   */
  async nextAsk(orgId: string, userId: string, now: Date = new Date()) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { radarEnabled: true, plan: true },
    });
    if (!org?.radarEnabled || !radarAvailable(org.plan)) return null;

    const membership = await this.membership(orgId, userId);
    if (!canAskInterests(membership as InterestAskState, now)) return null;

    const [tags, answered, recent] = await Promise.all([
      this.tags(orgId),
      this.prisma.memberInterest.findMany({
        where: { userOrgId: membership.id, declared: { not: null } },
        select: { tagId: true },
      }),
      this.prisma.event.findMany({
        where: { orgId, isPublished: true, startTime: { gte: daysAgo(now, 180) } },
        select: { tags: true },
        take: 300,
      }),
    ]);

    const answeredIds = new Set(answered.map((row) => row.tagId));
    const used = new Map<string, number>();
    for (const event of recent) {
      for (const tag of event.tags) used.set(tag, (used.get(tag) ?? 0) + 1);
    }

    const offer = tags
      .filter((tag) => !answeredIds.has(tag.id))
      .sort((a, b) => (used.get(b.name) ?? 0) - (used.get(a.name) ?? 0) || a.sortOrder - b.sortOrder)
      .slice(0, INTERESTS_PER_ASK);

    if (offer.length === 0) return null;

    return {
      interests: offer.map((tag) => ({ tagId: tag.id, name: tag.name, emoji: tag.emoji })),
    };
  }

  /** Waved away. Widens the gap; three of them end the asking. */
  async dismissAsk(orgId: string, userId: string) {
    const membership = await this.membership(orgId, userId);
    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: afterDismissal(membership as InterestAskState),
    });
  }

  async setRadarEmails(orgId: string, userId: string, on: boolean) {
    const membership = await this.membership(orgId, userId);
    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { radarEmails: on },
    });
    return { radarEmails: on };
  }

  /**
   * One click, from an email, with no session.
   *
   * Returns the co-op's name so the page can say what was switched off, and
   * null when the token is anything other than exactly right — a bad token
   * must not unsubscribe a guessed membership.
   */
  async unsubscribeByToken(userOrgId: string): Promise<{ orgName: string } | null> {
    const membership = await this.prisma.userOrg.findUnique({
      where: { id: userOrgId },
      select: { id: true, org: { select: { name: true } } },
    });
    if (!membership) return null;

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { radarEmails: false },
    });

    return { orgName: membership.org.name };
  }

  // ---------------------------------------------------------------------
  // Learning from RSVPs
  // ---------------------------------------------------------------------

  /**
   * Count an RSVP toward the interests the event carries.
   *
   * Called after an RSVP is confirmed, and never allowed to fail the RSVP: a
   * member getting a seat matters, and MaybeOS's opinion about their taste
   * does not. Only tags that are on the co-op's current list count, so a
   * free-text leftover from an older event teaches nothing.
   */
  async recordRsvp(orgId: string, eventId: string, userId: string): Promise<void> {
    try {
      const [event, membership] = await Promise.all([
        this.prisma.event.findFirst({ where: { id: eventId, orgId }, select: { tags: true } }),
        this.prisma.userOrg.findFirst({ where: { orgId, userId }, select: { id: true } }),
      ]);
      if (!event || !membership || event.tags.length === 0) return;

      const tags = await this.prisma.interestTag.findMany({
        where: { orgId, name: { in: event.tags } },
        select: { id: true },
      });
      if (tags.length === 0) return;

      const now = new Date();
      await this.prisma.$transaction(
        tags.map((tag) =>
          this.prisma.memberInterest.upsert({
            where: { userOrgId_tagId: { userOrgId: membership.id, tagId: tag.id } },
            create: { userOrgId: membership.id, tagId: tag.id, rsvpCount: 1, lastRsvpAt: now },
            update: { rsvpCount: { increment: 1 }, lastRsvpAt: now },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(`Radar could not record an RSVP interest: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------
  // The digest
  // ---------------------------------------------------------------------

  /**
   * Send every digest that is due (the `send-radar-digests` scheduler task).
   *
   * Due means: the co-op has Radar on, is on a plan that includes it, and its
   * own clock has reached the day and hour it chose. One co-op's failure must
   * never stop another's, so each is wrapped on its own.
   */
  async sendDue(now: Date = new Date()): Promise<RadarRunResult> {
    const orgs = await this.prisma.organization.findMany({
      where: { radarEnabled: true, plan: { in: ['PLUS', 'UNLIMITED'] } },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        radarDigestDay: true,
        radarDigestHour: true,
      },
    });

    const result: RadarRunResult = { processed: 0, failed: 0, errors: [] };

    for (const org of orgs) {
      const local = zonedParts(now, org.timezone);
      if (local.dayOfWeek !== org.radarDigestDay) continue;
      if (Math.floor(local.minutes / 60) !== org.radarDigestHour) continue;

      try {
        result.processed += await this.sendForOrg(org, now);
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${org.slug}: ${(error as Error).message}`);
      }
    }

    return result;
  }

  private async sendForOrg(
    org: { id: string; name: string; slug: string; timezone: string },
    now: Date,
  ): Promise<number> {
    const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

    // Everything open to members. A PRIVATE event is nobody's business, and a
    // cancelled one is worse than no email at all.
    const events = await this.prisma.event.findMany({
      where: {
        orgId: org.id,
        isPublished: true,
        canceledAt: null,
        visibility: { in: ['PUBLIC', 'MEMBERS_ONLY'] },
        startTime: { gte: now, lte: horizon },
        tags: { isEmpty: false },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        startTime: true,
        timezone: true,
        tags: true,
        priceCents: true,
        location: { select: { name: true } },
        room: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    if (events.length === 0) return 0;

    const members = await this.prisma.userOrg.findMany({
      where: {
        orgId: org.id,
        radarEmails: true,
        role: { in: ['ADMIN', 'STAFF', 'MEMBER'] },
        interests: { some: { OR: [{ declared: true }, { rsvpCount: { gt: 0 } }] } },
        // Two independent either-ors, so they are spelled as an AND of two.
        // Written as two `OR` keys on one object the second silently replaces
        // the first — a JavaScript object literal keeps the last duplicate —
        // and the condition that disappears is whichever was written first.
        AND: [
          {
            // A member who has unsubscribed from the co-op's email has
            // unsubscribed from this too. `emailOptIn` is three-valued: true
            // opted in, false opted out, null never asked. Written as
            // `{ not: false }` this excluded the nulls, because `NULL <> false`
            // is NULL in SQL rather than true — so every member who had never
            // been asked was skipped, which on a real co-op is almost
            // everybody, and it looked exactly like a week with no matches.
            OR: [{ emailOptIn: null }, { emailOptIn: true }],
          },
          {
            OR: [
              { radarLastSentAt: null },
              { radarLastSentAt: { lt: daysAgo(now, MIN_DAYS_BETWEEN_DIGESTS) } },
            ],
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true, email: true } },
        interests: {
          select: { declared: true, rsvpCount: true, tag: { select: { name: true, isActive: true } } },
        },
        radarSends: { select: { eventId: true } },
      },
      take: BATCH,
    });

    let sent = 0;

    for (const member of members) {
      if (!member.user?.email) continue;

      const alreadySent = new Set(member.radarSends.map((row) => row.eventId));

      // Something they have already said yes to is not news. Scoped to this
      // member and to the events in hand — an RSVP in another co-op, or to
      // something last year, has no bearing on what this digest should say.
      const rsvped = await this.prisma.rsvp.findMany({
        where: {
          userId: member.userId,
          status: { not: 'CANCELED' },
          eventId: { in: events.map((event) => event.id) },
        },
        select: { eventId: true },
      });
      const theirRsvps = new Set(rsvped.map((row) => row.eventId));

      const standings: InterestStanding[] = member.interests
        .filter((interest) => interest.tag.isActive)
        .map((interest) => ({
          tagName: interest.tag.name,
          declared: interest.declared,
          rsvpCount: interest.rsvpCount,
        }));

      const candidates = events.filter(
        (event) => !alreadySent.has(event.id) && !theirRsvps.has(event.id),
      );

      const matches = rankMatches(candidates, standings, MAX_PER_DIGEST);
      if (matches.length === 0) continue;

      // Recorded before the send, like `doorPinEmailedAt`: EmailService
      // swallows failures, so the only honest thing a marker can mean is that
      // we tried. Mentioning a gathering once and missing beats mentioning it
      // every fifteen minutes.
      await this.prisma.$transaction([
        this.prisma.radarSend.createMany({
          data: matches.map((match) => ({ userOrgId: member.id, eventId: match.event.id })),
          skipDuplicates: true,
        }),
        this.prisma.userOrg.update({
          where: { id: member.id },
          data: { radarLastSentAt: now },
        }),
      ]);

      await this.email.sendRadarDigest(member.user.email, {
        memberName: member.user.name ?? 'there',
        orgName: org.name,
        events: matches.map((match) => ({
          title: match.event.title,
          when: match.event.startTime.toLocaleString('en-US', {
            timeZone: match.event.timezone,
            dateStyle: 'full',
            timeStyle: 'short',
          }),
          where: match.event.room?.name ?? match.event.location?.name ?? null,
          description: match.event.description ?? null,
          matched: match.matched,
          declaredMatches: match.declaredMatches,
          ticketed: match.event.priceCents !== null,
          rsvpUrl: this.rsvpUrl(org.slug, match.event.slug, match.event.priceCents !== null),
        })),
        unsubscribeUrl: this.unsubscribeUrl(member.id),
        interestsUrl: `${this.appUrl()}/member/${org.slug}/profile#interests`,
      });

      sent += 1;
    }

    return sent;
  }

  private appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
  }

  /**
   * Where the RSVP button goes.
   *
   * To the event in MaybeOS, signed in, with `?rsvp=radar` — **not** to an
   * endpoint that books a seat. A link in an email is followed by spam
   * filters, link previews and corporate scanners, and none of them should be
   * able to RSVP on a member's behalf. The page takes it from there.
   */
  private rsvpUrl(orgSlug: string, eventSlug: string, ticketed: boolean): string {
    const event = `${this.appUrl()}/portal/${orgSlug}/events/${eventSlug}`;
    // A ticketed event is bought, not RSVPed: the page offers Buy and refuses
    // to book a free seat, so sending `?rsvp=radar` would ask it for something
    // it will not do and leave the member looking at a button they did not
    // come for.
    return ticketed ? event : `${event}?rsvp=radar`;
  }

  private unsubscribeUrl(userOrgId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const token = encodeUnsubscribe({ userOrgId, purpose: 'radar' }, secret);
    return `${this.appUrl()}/radar/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
