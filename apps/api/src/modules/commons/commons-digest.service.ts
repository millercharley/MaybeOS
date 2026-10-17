import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { encodeUnsubscribe } from '../../common/unsubscribe-token';
import {
  digestFor,
  digestWindow,
  isAway,
  totalPosts,
  wantsDigest,
  worthSending,
  type DigestPost,
} from './commons-digest';
import { zonedParts } from '../space/availability/zoned-time';

/** The most members one run will consider, so a run has a known ceiling. */
const BATCH = 200;

/** Days before the same member may be sent another. */
const MIN_DAYS_BETWEEN = 6;

/**
 * The weekly Commons digest (CMN-20).
 *
 * Charley's rule: a direct message emails immediately, and the Commons is a
 * weekly digest of what a member missed **if they were not here**. That
 * qualifier is the design — this is not a newsletter, and a member who reads
 * the Commons never receives one.
 *
 * Bulk mail by every definition: sent on a schedule, to everybody who
 * qualifies, carrying an unsubscribe link. It therefore goes out on the
 * broadcast stream (EML-04), away from the sign-in links whose reputation it
 * would otherwise spend.
 */
@Injectable()
export class CommonsDigestService {
  private readonly logger = new Logger(CommonsDigestService.name);

  /** Inside Postmark's ten concurrent connections, modest against the pool. */
  private static readonly CONCURRENCY = 8;

  /** Checked between groups, never inside one (RDR-04). */
  private static readonly DEADLINE_MS = 8_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** Send every digest that is due. One co-op's failure never stops another. */
  async sendDue(now: Date = new Date()) {
    const orgs = await this.prisma.organization.findMany({
      where: { commonsDigestEnabled: true },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        replyToEmail: true,
        commonsDigestDay: true,
        commonsDigestHour: true,
      },
    });

    const result = { processed: 0, failed: 0, errors: [] as string[] };

    for (const org of orgs) {
      const local = zonedParts(now, org.timezone);
      if (local.dayOfWeek !== org.commonsDigestDay) continue;
      if (Math.floor(local.minutes / 60) !== org.commonsDigestHour) continue;

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
    org: {
      id: string;
      name: string;
      slug: string;
      timezone: string;
      replyToEmail: string | null;
    },
    now: Date,
  ): Promise<number> {
    const { since } = digestWindow(now);

    /*
      Everything posted in the window, once.

      Read before the members are, and deliberately: a week with nothing in
      it is the common case for a quiet co-op, and the cheapest thing to do
      about it is nothing at all.
    */
    const rows = await this.prisma.post.findMany({
      where: { channel: { orgId: org.id }, createdAt: { gte: since }, isFlagged: false },
      select: {
        id: true,
        channelId: true,
        authorId: true,
        title: true,
        body: true,
        createdAt: true,
        channel: { select: { name: true, emoji: true } },
        author: { select: { name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (rows.length === 0) return 0;

    const posts: DigestPost[] = rows.map((p) => ({
      id: p.id,
      channelId: p.channelId,
      channelName: p.channel.name,
      channelEmoji: p.channel.emoji,
      authorId: p.authorId,
      authorName: p.author?.name ?? null,
      title: p.title,
      body: p.body,
      createdAt: p.createdAt,
      commentCount: p._count.comments,
    }));

    const members = await this.prisma.userOrg.findMany({
      where: {
        orgId: org.id,
        commonsDigestEmails: true,
        role: { in: ['ADMIN', 'STAFF', 'MEMBER'] },
        // Two independent either-ors, so they are spelled as an AND of two:
        // written as two `OR` keys on one object the second silently
        // replaces the first, and the condition that disappears is whichever
        // was written first.
        AND: [
          {
            // Three-valued, and the null is the trap — `{ not: false }`
            // excludes it, because `NULL <> false` is NULL rather than true,
            // and on a real co-op almost everybody is null.
            OR: [{ emailOptIn: null }, { emailOptIn: true }],
          },
          {
            OR: [
              { commonsDigestSentAt: null },
              {
                commonsDigestSentAt: {
                  lt: new Date(now.getTime() - MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000),
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        altEmail: true,
        emailOptIn: true,
        commonsDigestEmails: true,
        user: { select: { name: true, email: true, lastLoginAt: true } },
      },
      take: BATCH,
    });
    if (members.length === 0) return 0;

    const active = await this.activeSince(
      members.map((m) => m.userId),
      since,
    );

    const owed = members.filter(
      (m) =>
        m.user?.email &&
        wantsDigest(m) &&
        isAway({ userId: m.userId, lastLoginAt: m.user.lastLoginAt }, active, since),
    );
    if (owed.length === 0) return 0;

    const web = this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
    const stopBy = Date.now() + CommonsDigestService.DEADLINE_MS;
    let sent = 0;

    const sendTo = async (member: (typeof owed)[number]): Promise<boolean> => {
      const channels = digestFor(posts, member.userId);
      if (!worthSending(channels)) return false;

      /*
        Marked before the send, like every other scheduled mailing here: the
        marker can only honestly mean "we tried", because EmailService
        swallows a provider failure. A member hearing about a week once and
        missing it beats hearing about it every fifteen minutes.
      */
      await this.prisma.userOrg.update({
        where: { id: member.id },
        data: { commonsDigestSentAt: now },
      });

      await this.email.sendCommonsDigest(
        // Both addresses a member reads (MEM-19).
        { primary: member.user!.email as string, also: member.altEmail },
        {
          memberName: member.user?.name ?? 'there',
          orgName: org.name,
          channels: channels.map((c) => ({
            name: c.channelName,
            emoji: c.channelEmoji,
            total: c.total,
            posts: c.posts.map((p) => ({
              title: p.title,
              body: p.body,
              authorName: p.authorName,
              commentCount: p.commentCount,
              url: `${web}/portal/${org.slug}/commons?channel=${c.channelId}#post-${p.id}`,
            })),
          })),
          totalPosts: totalPosts(channels),
          commonsUrl: `${web}/portal/${org.slug}/commons`,
          unsubscribeUrl: this.unsubscribeUrl(member.id),
          replyTo: org.replyToEmail,
        },
      );

      return true;
    };

    // Groups of eight with the clock checked between them, so a group that
    // has started always finishes (RDR-04).
    for (let i = 0; i < owed.length; i += CommonsDigestService.CONCURRENCY) {
      if (Date.now() > stopBy) break;

      const group = owed.slice(i, i + CommonsDigestService.CONCURRENCY);
      const results = await Promise.all(group.map(sendTo));
      sent += results.filter(Boolean).length;
    }

    return sent;
  }

  /**
   * Everyone who did anything at all in the window.
   *
   * Four tables asked once each, rather than four reads per member: reading
   * is tracked per channel and per thread, writing per post and per comment,
   * and nothing carries a single "last seen" column.
   */
  private async activeSince(userIds: string[], since: Date): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();

    const [channelReads, threadReads, posts, comments] = await Promise.all([
      this.prisma.channelRead.findMany({
        where: { userId: { in: userIds }, lastReadAt: { gte: since } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.threadParticipant.findMany({
        where: { userId: { in: userIds }, lastReadAt: { gte: since } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.post.findMany({
        where: { authorId: { in: userIds }, createdAt: { gte: since } },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
      this.prisma.comment.findMany({
        where: { authorId: { in: userIds }, createdAt: { gte: since } },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
    ]);

    return new Set([
      ...channelReads.map((r) => r.userId),
      ...threadReads.map((r) => r.userId),
      ...posts.map((r) => r.authorId),
      ...comments.map((r) => r.authorId),
    ]);
  }

  /**
   * Whether this member gets the weekly digest, read rather than assumed.
   *
   * A member who stopped it from the footer of one and then opened their
   * profile would otherwise find the switch on — the product contradicting a
   * choice they had already made.
   */
  async myEmails(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { commonsDigestEmails: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    return { commonsDigestEmails: membership.commonsDigestEmails };
  }

  async setEmails(orgId: string, userId: string, on: boolean) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { commonsDigestEmails: on },
    });
    return { commonsDigestEmails: on };
  }

  /**
   * Stop the weekly digest for one membership, from the link in one.
   *
   * Returns the co-op's name so the page can say whose emails stopped, and
   * null for a membership that no longer exists — the caller gives the same
   * answer for that as for a bad token, so a guessed one learns nothing.
   */
  async unsubscribeByToken(userOrgId: string): Promise<{ orgName: string } | null> {
    const membership = await this.prisma.userOrg.findUnique({
      where: { id: userOrgId },
      select: { id: true, org: { select: { name: true } } },
    });
    if (!membership) return null;

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { commonsDigestEmails: false },
    });

    return { orgName: membership.org.name };
  }

  private unsubscribeUrl(userOrgId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const token = encodeUnsubscribe({ userOrgId, purpose: 'commons' }, secret);
    const web = this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
    /*
      The shared page, which lives under `/radar` for historical reasons.

      One route stops any of these emails and words itself from the purpose
      inside the token (RDR-01, RCP-01). The path is a misleading name rather
      than a wrong destination: renaming it would break the links in every
      email already sent, which is a worse trade than an odd-looking URL.
    */
    return `${web}/radar/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}
