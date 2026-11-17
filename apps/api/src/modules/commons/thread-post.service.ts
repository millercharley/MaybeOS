import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { escapeHtml } from '../../common/escape-html';
import {
  THREAD_CHANNELS,
  shouldAnnounce,
  threadOwnerId,
  whyNotAnnounced,
  type ThreadChannel,
} from './thread-policy';

/**
 * Putting what the co-op is running into the Commons, so people can ask
 * about it (CMN-22).
 *
 * Lives in the Commons module rather than in Events and Teaching, because
 * both need it and a copy in each is how the two drift into posting
 * differently. Commons imports neither of them, so there is no cycle.
 *
 * **Every method here is best-effort and says so.** A thread is a nice thing
 * to have alongside an event; it is not the event. If the Commons write
 * fails, publishing must still succeed — a member who pressed Publish and
 * got an error about a channel would reasonably conclude their workshop did
 * not go up.
 */
@Injectable()
export class ThreadPostService {
  private readonly logger = new Logger(ThreadPostService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The co-op's #Events or #Teaching channel, making it if it is missing.
   *
   * Upsert on `(orgId, slug)` — the unique index is what actually decides,
   * and two members publishing at the same second would otherwise both try
   * to create it. `update: {}` on purpose: a co-op that renamed Events to
   * "What's On" keeps its name.
   */
  async ensureChannel(orgId: string, kind: ThreadChannel): Promise<string> {
    const shape = THREAD_CHANNELS[kind];

    const channel = await this.prisma.channel.upsert({
      where: { orgId_slug: { orgId, slug: shape.slug } },
      create: {
        orgId,
        slug: shape.slug,
        name: shape.name,
        emoji: shape.emoji,
        description: shape.description,
      },
      update: {},
      select: { id: true },
    });

    return channel.id;
  }

  /**
   * Announce an event, if it is the sort of thing that should be announced.
   *
   * The thread hangs off the series root, so a workshop repeating weekly for
   * a term is one conversation rather than twelve.
   */
  async announceEvent(orgId: string, eventId: string): Promise<{ postId: string | null }> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        parentEventId: true,
        title: true,
        slug: true,
        postId: true,
        isPublished: true,
        visibility: true,
        offeringId: true,
        hostId: true,
        createdById: true,
        org: { select: { slug: true } },
      },
    });
    if (!event) return { postId: null };

    /*
      The series root holds the thread. Read separately when this is not it,
      because the child's own `postId` says nothing about whether the series
      has already been announced.
    */
    const ownerId = threadOwnerId(event);
    const owner =
      ownerId === event.id
        ? event
        : await this.prisma.event.findFirst({
            where: { id: ownerId, orgId },
            select: {
              id: true,
              title: true,
              slug: true,
              postId: true,
              hostId: true,
              createdById: true,
            },
          });
    if (!owner) return { postId: null };

    const verdict = {
      isPublished: event.isPublished,
      visibility: event.visibility as 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE',
      alreadyThreaded: owner.postId !== null,
      belongsToOffering: event.offeringId !== null,
    };

    if (!shouldAnnounce(verdict)) {
      this.logger.debug(
        `Event ${event.id} not announced: ${whyNotAnnounced(verdict) ?? 'no reason given'}`,
      );
      return { postId: owner.postId ?? null };
    }

    return this.post({
      orgId,
      kind: 'events',
      // Theirs, not whoever pressed the button. An organiser publishing on a
      // member's behalf should not appear to be the one running it.
      authorId: owner.hostId ?? owner.createdById,
      title: owner.title,
      href: `/portal/${event.org.slug}/events/${owner.slug}`,
      lead: 'Discussion for',
      claim: (postId) =>
        this.prisma.event.updateMany({
          where: { id: owner.id, postId: null },
          data: { postId },
        }),
      settled: () =>
        this.prisma.event
          .findFirst({ where: { id: owner.id, orgId }, select: { postId: true } })
          .then((row) => row?.postId ?? null),
    });
  }

  /** The same, for something a member is teaching. */
  async announceOffering(orgId: string, offeringId: string): Promise<{ postId: string | null }> {
    const offering = await this.prisma.offering.findFirst({
      where: { id: offeringId, orgId },
      select: {
        id: true,
        title: true,
        slug: true,
        postId: true,
        isPublished: true,
        visibility: true,
        teacherId: true,
        createdById: true,
        org: { select: { slug: true } },
      },
    });
    if (!offering) return { postId: null };

    const verdict = {
      isPublished: offering.isPublished,
      visibility: offering.visibility as 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE',
      alreadyThreaded: offering.postId !== null,
    };

    if (!shouldAnnounce(verdict)) {
      this.logger.debug(
        `Offering ${offering.id} not announced: ${whyNotAnnounced(verdict) ?? 'no reason given'}`,
      );
      return { postId: offering.postId ?? null };
    }

    return this.post({
      orgId,
      kind: 'teaching',
      authorId: offering.teacherId ?? offering.createdById,
      title: offering.title,
      href: `/portal/${offering.org.slug}/teaching/${offering.slug}`,
      lead: 'Being taught here:',
      claim: (postId) =>
        this.prisma.offering.updateMany({
          where: { id: offering.id, postId: null },
          data: { postId },
        }),
      settled: () =>
        this.prisma.offering
          .findFirst({ where: { id: offering.id, orgId }, select: { postId: true } })
          .then((row) => row?.postId ?? null),
    });
  }

  /**
   * Write the post and claim it, or lose the race cleanly.
   *
   * The claim is `updateMany ... where postId IS NULL` rather than a plain
   * update, which is what EVT-42 learned: two requests both create a post and
   * both updates would otherwise succeed, the second orphaning the first
   * thread and every comment on it. Claiming only while the column is still
   * null means one of them loses, and the loser deletes the post it made.
   */
  private async post(args: {
    orgId: string;
    kind: ThreadChannel;
    authorId: string | null;
    title: string;
    href: string;
    lead: string;
    claim: (postId: string) => Promise<{ count: number }>;
    settled: () => Promise<string | null>;
  }): Promise<{ postId: string | null }> {
    /*
      Nobody to post as. An event whose host and creator are both gone is a
      row nothing can be attributed to, and a post with no author is not a
      thing this schema can hold.
    */
    if (!args.authorId) return { postId: null };

    const channelId = await this.ensureChannel(args.orgId, args.kind);

    const created = await this.prisma.post.create({
      data: {
        channelId,
        authorId: args.authorId,
        title: args.title,
        /*
          Deliberately thin, and linked. The detail lives on the event or
          offering page — a copy here would be a second version of the truth
          to keep in step — but a thread announcing something nobody can
          click through to is a poor announcement.

          Escaped: the title is written by a member and this body is stored
          and rendered as HTML.
        */
        body: `<p>${args.lead} <a href="${args.href}">${escapeHtml(args.title)}</a>.</p>`,
      },
      select: { id: true },
    });

    const claimed = await args.claim(created.id);
    if (claimed.count === 1) return { postId: created.id };

    await this.prisma.post.delete({ where: { id: created.id } }).catch(() => {});
    return { postId: await args.settled() };
  }
}
