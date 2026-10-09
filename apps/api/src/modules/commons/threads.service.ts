import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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

    return message;
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
