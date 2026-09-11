import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ContactViewer } from '../../common/access/contact-visibility';
import { safeLinks } from './member.service';

/** How many recent posts and comments a card lists. Counts are exact; lists are the latest. */
const RECENT = 20;

/**
 * Plain text from a post or comment body, shortened for a list.
 *
 * Bodies are rich text (CNT-01), and a card renders them as text — never as
 * HTML — so tags are stripped rather than trusted.
 */
export function excerpt(text: string | null | undefined, max = 160): string {
  const plain = (text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * One member, as the card that opens on their name shows them (MEM-18).
 *
 * Modelled on Circle's profile: who they are, when they joined, a way to say
 * hello, and what they have written. Built for exactly one screen and shaped
 * from named fields, never by spreading a record:
 *
 * - **No email and no phone, for any role.** The card opens on every page in
 *   MaybeOS, and "click a name, get an address" is the thing the directory
 *   promised never to be. Organisers have the admin members page for that.
 * - **A hidden member stays hidden.** Somebody who set `isPublic: false`
 *   opened from their own post still gets a card — their name is already on
 *   the post — but only name, face and join date, and a way to message them.
 *   Organisers and the member themselves see everything, as the directory
 *   always allowed.
 * - **Only what the Commons would show this viewer, minus event threads.**
 *   An event's conversation is a post in the shared `events` channel, and
 *   whether it belongs on a person's profile is the event's question, not
 *   the profile's. Leaving them out cannot leak anything; including them
 *   might, the day a private event has a thread.
 * - **Nothing invented.** No "last seen": MaybeOS does not record it
 *   (`lastLoginAt` is never written). "Last posted" is real, so it is shown.
 */
@Injectable()
export class MemberProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(orgId: string, userId: string, viewer: ContactViewer) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
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
        user: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } },
        org: { select: { slug: true } },
      },
    });

    if (!membership) throw new NotFoundException('Not a member of this co-op');

    const isYou = viewer.userId === userId;
    const restricted = !membership.isPublic && !viewer.privileged && !isYou;

    const base = {
      userId,
      orgSlug: membership.org.slug,
      isYou,
      // Said only to the people who can see through it, so a member cannot
      // learn "this person is hiding" from a card they were refused.
      isHidden: !restricted && !membership.isPublic,
      restricted,
      role: membership.role,
      memberSince: membership.memberSince,
      user: membership.user,
    };

    if (restricted) return base;

    const postWhere = { authorId: userId, channel: { orgId }, eventThread: { is: null } };
    const commentWhere = {
      authorId: userId,
      post: { channel: { orgId }, eventThread: { is: null } },
    };

    const [postCount, commentCount, posts, comments] = await Promise.all([
      this.prisma.post.count({ where: postWhere }),
      this.prisma.comment.count({ where: commentWhere }),
      this.prisma.post.findMany({
        where: postWhere,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          channel: { select: { id: true, name: true } },
        },
      }),
      this.prisma.comment.findMany({
        where: commentWhere,
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        select: {
          id: true,
          body: true,
          createdAt: true,
          post: {
            select: {
              id: true,
              title: true,
              body: true,
              channel: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const newest = [posts[0]?.createdAt, comments[0]?.createdAt].filter(
      (date): date is Date => Boolean(date),
    );

    return {
      ...base,
      headline: membership.headline,
      bio: membership.bio,
      location: membership.location,
      tags: membership.tags,
      links: safeLinks(membership.links),
      lastPostedAt: newest.length ? new Date(Math.max(...newest.map((d) => d.getTime()))) : null,
      counts: { posts: postCount, comments: commentCount },
      posts: posts.map((post) => ({
        id: post.id,
        title: post.title,
        excerpt: excerpt(post.body),
        createdAt: post.createdAt,
        channel: post.channel,
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        excerpt: excerpt(comment.body),
        createdAt: comment.createdAt,
        post: {
          id: comment.post.id,
          title: comment.post.title,
          excerpt: excerpt(comment.post.body, 80),
          channel: comment.post.channel,
        },
      })),
    };
  }
}
