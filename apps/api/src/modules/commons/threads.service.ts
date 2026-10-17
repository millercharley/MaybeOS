import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { groupReactions, isAllowedReaction } from './reactions';
import {
  everyone,
  isGroup,
  participantKey,
  recipientProblem,
  threadName,
} from './threads';
import { readWindows } from './read-windows';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { preview, recipientsFor, type Participant } from './message-notifications';

/** What a conversation looks like in a list. */
export interface ThreadSummary {
  id: string;
  name: string;
  isGroup: boolean;
  participants: { userId: string; name: string | null; avatarUrl: string | null }[];
  lastMessage: { body: string; senderId: string; createdAt: Date } | null;
  lastMessageAt: Date;
  unreadCount: number;
}

const PERSON = { id: true, name: true, avatarUrl: true };

/**
 * Conversations between two or more members (CMN-16).
 *
 * Charley: "the user can type in one or more members, select that member or
 * members from the search list that appears as they type, and then compose a
 * message and send it. This can be a group message thread or an individual DM
 * thread."
 *
 * The design decision the rest of this file follows from: **a one-to-one is a
 * thread with two participants.** There is no separate DM type, no second code
 * path, and no screen that works for two people and not for three. What used
 * to be `direct_messages` — a sender and a receiver, with nowhere to put a
 * third person — is migrated into this and left dormant.
 *
 * Every method here proves membership of the thread before it reads or writes
 * anything. A thread id in a URL is a guess until checked, and the thing it
 * would expose is somebody's private conversation.
 */
@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ─── Reading ──────────────────────────────────────────────────

  /** Every conversation this member is in, newest first. */
  async listThreads(orgId: string, userId: string): Promise<ThreadSummary[]> {
    const seats = await this.prisma.threadParticipant.findMany({
      where: { userId, thread: { orgId } },
      select: { threadId: true, lastReadAt: true },
    });
    if (seats.length === 0) return [];

    const threadIds = seats.map((s) => s.threadId);
    const readAt = new Map(seats.map((s) => [s.threadId, s.lastReadAt]));

    const threads = await this.prisma.messageThread.findMany({
      where: { id: { in: threadIds } },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participants: { include: { user: { select: PERSON } } },
        // The last thing said, for the line under the name.
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    /*
      Counted per thread, in parallel, rather than in one grouped query:
      "newer than *my* last read" is a different cutoff for every thread, and
      a groupBy cannot express a per-row bound. The fan-out is bounded by how
      many conversations one person is in.
    */
    const unread = await Promise.all(
      threads.map(async (t) => {
        const since = readAt.get(t.id) ?? null;
        const count = await this.prisma.threadMessage.count({
          where: {
            threadId: t.id,
            senderId: { not: userId },
            ...(since ? { createdAt: { gt: since } } : {}),
          },
        });
        return [t.id, count] as const;
      }),
    );
    const unreadBy = new Map(unread);

    return threads.map((t) => {
      const people = t.participants.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        avatarUrl: p.user.avatarUrl,
      }));
      const last = t.messages[0];

      return {
        id: t.id,
        name: threadName(people, userId, t.title),
        isGroup: isGroup(people.length),
        participants: people,
        lastMessage: last
          ? { body: last.body, senderId: last.senderId, createdAt: last.createdAt }
          : null,
        lastMessageAt: t.lastMessageAt,
        unreadCount: unreadBy.get(t.id) ?? 0,
      };
    });
  }

  /** One conversation, in order, for somebody who is in it. */
  async getThread(orgId: string, userId: string, threadId: string) {
    const thread = await this.mine(orgId, userId, threadId);

    const [messages, participants] = await Promise.all([
      this.prisma.threadMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: PERSON },
          // Grouped below, because the page draws one pill per emoji rather
          // than one per person (CMN-17).
          reactions: { select: { emoji: true, userId: true } },
        },
        take: 200,
      }),
      this.prisma.threadParticipant.findMany({
        where: { threadId },
        include: { user: { select: PERSON } },
      }),
    ]);

    const people = participants.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      avatarUrl: p.user.avatarUrl,
    }));

    return {
      id: thread.id,
      name: threadName(people, userId, thread.title),
      isGroup: isGroup(people.length),
      participants: people,
      messages: messages.map((m) => ({
        ...m,
        reactions: groupReactions(m.reactions, userId),
      })),
    };
  }

  // ─── Writing ──────────────────────────────────────────────────

  /**
   * Start a conversation, or carry on the one these people already have.
   *
   * Find-or-create on the participant fingerprint. Choosing the same three
   * people twice must not leave two threads with the same three people in
   * them, each holding half the conversation.
   */
  async startThread(
    orgId: string,
    userId: string,
    input: { userIds: string[]; body: string; title?: string },
  ) {
    const body = input.body?.trim();
    if (!body) throw new BadRequestException('Write something to send.');

    // Who is actually in this co-op. Asked of the database rather than
    // trusted from the request (CMN-08).
    const members = await this.prisma.userOrg.findMany({
      where: { orgId, userId: { in: [...new Set(input.userIds)] } },
      select: { userId: true },
    });

    const problem = recipientProblem(userId, input.userIds, members.map((m) => m.userId));
    if (problem) throw new BadRequestException(problem);

    const people = everyone(userId, input.userIds);
    const key = participantKey(people);

    const thread = await this.prisma.messageThread.upsert({
      where: { orgId_participantKey: { orgId, participantKey: key } },
      create: {
        orgId,
        participantKey: key,
        createdById: userId,
        title: input.title?.trim() || null,
        lastMessageAt: new Date(),
        participants: { create: people.map((id) => ({ userId: id })) },
      },
      update: { lastMessageAt: new Date() },
    });

    await this.prisma.threadMessage.create({
      data: { threadId: thread.id, senderId: userId, body },
    });

    // The sender has read what they just wrote.
    await this.touchRead(thread.id, userId);

    /*
      The first message of all is still a message (CMN-19).

      Easy to miss, and the worst one to: starting a conversation is exactly
      the case where the other person has no reason to be looking. Both ways
      of writing to somebody go through the same notice.
    */
    await this.notifyParticipants(orgId, thread.id, userId, body);

    return this.getThread(orgId, userId, thread.id);
  }

  /**
   * The one-to-one thread with this person, made if it does not exist yet.
   *
   * Eight places in the product link to "message this member" by their user
   * id — the directory, a member card, an event's host, the buddy pages. They
   * all still work, and they all land in the same thread the Messages list
   * shows.
   */
  async threadWithUser(orgId: string, userId: string, otherUserId: string) {
    if (otherUserId === userId) {
      throw new BadRequestException('You cannot message yourself.');
    }
    const other = await this.prisma.userOrg.findFirst({
      where: { orgId, userId: otherUserId },
      select: { userId: true },
    });
    if (!other) throw new NotFoundException('That member is not in this co-op.');

    const key = participantKey([userId, otherUserId]);
    const existing = await this.prisma.messageThread.findUnique({
      where: { orgId_participantKey: { orgId, participantKey: key } },
    });
    if (existing) return this.getThread(orgId, userId, existing.id);

    // Created empty, deliberately: opening somebody's profile and pressing
    // Message should show an empty conversation, not send one.
    const thread = await this.prisma.messageThread.create({
      data: {
        orgId,
        participantKey: key,
        createdById: userId,
        participants: { create: [{ userId }, { userId: otherUserId }] },
      },
    });
    return this.getThread(orgId, userId, thread.id);
  }

  async sendToThread(orgId: string, userId: string, threadId: string, body: string) {
    const text = body?.trim();
    if (!text) throw new BadRequestException('Write something to send.');

    await this.mine(orgId, userId, threadId);

    const message = await this.prisma.threadMessage.create({
      data: { threadId, senderId: userId, body: text },
      include: { sender: { select: PERSON } },
    });

    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt },
    });
    await this.touchRead(threadId, userId);

    /*
      Tell the people it was written to (CMN-19).

      Awaited rather than fired and forgotten. This runs in a Netlify
      function whose container may be frozen the moment the response is
      written, and a notification nobody sent is indistinguishable from one
      nobody received — which is the failure this whole feature exists to
      end. The cost is the provider's round trip on the sender's request;
      `notifyParticipants` never throws, so it cannot cost them the message.
    */
    await this.notifyParticipants(orgId, threadId, userId, text);

    return message;
  }

  /**
   * Email everyone in a thread who is waiting to hear about it (CMN-19).
   *
   * Never throws. A member's message must land whatever the mail provider is
   * doing — the same bargain every other send in MaybeOS makes.
   */
  private async notifyParticipants(
    orgId: string,
    threadId: string,
    senderId: string,
    body: string,
  ): Promise<void> {
    try {
      const [sender, org, participants] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: senderId }, select: { name: true } }),
        this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, slug: true, replyToEmail: true },
        }),
        this.prisma.threadParticipant.findMany({
          where: { threadId },
          select: {
            userId: true,
            lastReadAt: true,
            notifiedAt: true,
            user: { select: { name: true, email: true } },
          },
        }),
      ]);
      if (!org) return;

      /*
        The two switches live on the membership, not the user: one person may
        belong to several co-ops and want this from one of them.
      */
      const memberships = await this.prisma.userOrg.findMany({
        where: { orgId, userId: { in: participants.map((p) => p.userId) } },
        select: { userId: true, altEmail: true, emailOptIn: true, messageEmails: true },
      });
      const byUser = new Map(memberships.map((m) => [m.userId, m]));

      const rows: Participant[] = participants.map((p) => {
        const membership = byUser.get(p.userId);
        return {
          userId: p.userId,
          lastReadAt: p.lastReadAt,
          notifiedAt: p.notifiedAt,
          // Absent membership means they are not in this co-op any more.
          emailOptIn: membership?.emailOptIn ?? null,
          messageEmails: membership?.messageEmails ?? false,
          email: p.user?.email ?? null,
          altEmail: membership?.altEmail ?? null,
        };
      });

      const recipients = recipientsFor(rows, senderId);
      if (recipients.length === 0) return;

      const web = this.config.get<string>('WEB_URL') ?? 'https://maybeos.org';
      const { text, truncated } = preview(body);
      const names = new Map(participants.map((p) => [p.userId, p.user?.name ?? null]));

      await Promise.all(
        recipients.map(async (r) => {
          await this.email.sendDirectMessage(
            // Both addresses a member reads (MEM-19).
            { primary: r.email as string, also: r.altEmail },
            {
              recipientName: names.get(r.userId) ?? null,
              senderName: sender?.name ?? 'A member',
              orgName: org.name,
              message: text,
              truncated,
              threadUrl: `${web}/portal/${org.slug}/messages/t/${threadId}`,
              settingsUrl: `${web}/member/${org.slug}/profile`,
              replyTo: org.replyToEmail,
            },
          );

          /*
            Written after the send, not before.

            The mark means "this person has been told", and the suppression
            rule reads it to stay quiet. Setting it before sending would let
            a provider failure silence every later message in the thread —
            the member would never hear about any of them.
          */
          await this.prisma.threadParticipant.updateMany({
            where: { threadId, userId: r.userId },
            data: { notifiedAt: new Date() },
          });
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Could not notify thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Whether this member is emailed when somebody writes to them (CMN-19).
   *
   * Read rather than assumed from the schema default: a member who turned
   * these off from the footer of an email and then opened their profile
   * would otherwise find the switch on — the product contradicting a choice
   * they had already made.
   */
  async myMessageEmails(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { messageEmails: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    return { messageEmails: membership.messageEmails };
  }

  async setMessageEmails(orgId: string, userId: string, on: boolean) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    await this.prisma.userOrg.update({ where: { id: membership.id }, data: { messageEmails: on } });
    return { messageEmails: on };
  }

  /** Opening a conversation is reading it. */
  async markThreadRead(orgId: string, userId: string, threadId: string) {
    await this.mine(orgId, userId, threadId);
    await this.touchRead(threadId, userId);
  }

  // ─── Reactions (CMN-17) ───────────────────────────────────────

  /**
   * Leave an emoji on a message, or take it back.
   *
   * A toggle rather than add-and-remove: pressing the same emoji twice means
   * "I did not mean that", and making the caller decide which of two calls to
   * send is how a double tap becomes two hearts.
   */
  async toggleMessageReaction(
    orgId: string,
    userId: string,
    threadId: string,
    messageId: string,
    emoji: string,
  ) {
    if (!isAllowedReaction(emoji)) {
      throw new BadRequestException('That is not one of the reactions.');
    }
    // Being in the conversation is the whole permission. Somebody who cannot
    // read a message must not be able to react to it (CMN-16).
    await this.mine(orgId, userId, threadId);

    const message = await this.prisma.threadMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found');

    const existing = await this.prisma.threadMessageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });

    if (existing) {
      await this.prisma.threadMessageReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.threadMessageReaction.create({
        data: { messageId, userId, emoji },
      });
    }

    const rows = await this.prisma.threadMessageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });

    return { messageId, reactions: groupReactions(rows, userId) };
  }

  // ─── The badge ────────────────────────────────────────────────

  /** How many messages across every conversation this member has not read. */
  async unreadMessages(orgId: string, userId: string): Promise<number> {
    const seats = await this.prisma.threadParticipant.findMany({
      where: { userId, thread: { orgId } },
      select: { threadId: true, lastReadAt: true },
    });
    if (seats.length === 0) return 0;

    /*
      One query, whatever the number of threads (CMN-25).

      It was a `count` per seat, all at once, on the same sixty-second timer
      as the Commons badge beside it. Threads per member are few today, which
      is exactly why this was easy to miss — the cost is paid per signed-in
      member per minute, not per thread.
    */
    const windows = readWindows(
      seats.map((seat) => ({ id: seat.threadId, after: seat.lastReadAt })),
    );

    return this.prisma.threadMessage.count({
      where: {
        senderId: { not: userId },
        OR: windows.map((w) => ({
          threadId: { in: w.ids },
          ...(w.after ? { createdAt: { gt: w.after } } : {}),
        })),
      },
    });
  }

  // ─── Shared ───────────────────────────────────────────────────

  /**
   * The thread, if this person is in it.
   *
   * Both halves matter: the co-op, because a thread id from another tenant
   * must not resolve (SEC-04); and the seat, because a thread id is a guess
   * until checked and what it would otherwise expose is a private
   * conversation.
   */
  private async mine(orgId: string, userId: string, threadId: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, orgId },
    });
    if (!thread) throw new NotFoundException('Conversation not found');

    const seat = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!seat) throw new ForbiddenException('You are not in this conversation.');

    return thread;
  }

  private async touchRead(threadId: string, userId: string) {
    await this.prisma.threadParticipant.updateMany({
      where: { threadId, userId },
      data: { lastReadAt: new Date() },
    });
  }
}
