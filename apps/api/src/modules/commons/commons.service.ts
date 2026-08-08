import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CreateCollectionDto, UpdateCollectionDto } from './dto/create-collection.dto';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import { VoteChoice } from '@prisma/client';

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true } as const;

@Injectable()
export class CommonsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Channels ───────────────────────────────────────────────

  async createChannel(orgId: string, dto: CreateChannelDto) {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return this.prisma.channel.create({
      data: {
        orgId,
        name: dto.name,
        slug,
        description: dto.description,
        isPublic: dto.isPublic ?? true,
      },
    });
  }

  async listChannels(orgId: string) {
    return this.prisma.channel.findMany({
      where: { orgId },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async pinChannel(channelId: string, isPinned: boolean) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return this.prisma.channel.update({
      where: { id: channelId },
      data: { isPinned },
    });
  }

  // ─── Posts ──────────────────────────────────────────────────

  async createPost(channelId: string, authorId: string, dto: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        channelId,
        authorId,
        title: dto.title,
        body: dto.body,
      },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async listPosts(channelId: string, page: number, perPage: number) {
    const skip = (page - 1) * perPage;

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { comments: true, reactions: true } },
        },
      }),
      this.prisma.post.count({ where: { channelId } }),
    ]);

    return { data: posts, total, page, perPage };
  }

  async getPost(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: AUTHOR_SELECT },
          },
        },
        reactions: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Comments come back flat (with parentId); nest them into a reply tree.
    const byId = new Map(post.comments.map((c) => [c.id, { ...c, replies: [] as any[] }]));
    const roots: any[] = [];
    for (const comment of byId.values()) {
      if (comment.parentId && byId.has(comment.parentId)) {
        byId.get(comment.parentId)!.replies.push(comment);
      } else {
        roots.push(comment);
      }
    }

    return { ...post, comments: roots };
  }

  // ─── Comments ───────────────────────────────────────────────

  async addComment(postId: string, authorId: string, body: string, parentId?: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.postId !== postId) {
        throw new NotFoundException('Parent comment not found on this post');
      }
    }

    return this.prisma.comment.create({
      data: { postId, authorId, body, parentId },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  // ─── Reactions ──────────────────────────────────────────────

  async addReaction(postId: string, userId: string, emoji: string) {
    return this.prisma.reaction.upsert({
      where: {
        postId_userId_emoji: { postId, userId, emoji },
      },
      update: {},
      create: { postId, userId, emoji },
    });
  }

  async removeReaction(postId: string, userId: string, emoji: string) {
    await this.prisma.reaction.deleteMany({
      where: { postId, userId, emoji },
    });
  }

  // ─── Flagging ───────────────────────────────────────────────

  async flagPost(postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.prisma.post.update({
      where: { id: postId },
      data: { isFlagged: true },
    });
  }

  async flagComment(commentId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { isFlagged: true },
    });
  }

  // ─── Proposals ──────────────────────────────────────────────

  async createProposal(channelId: string, authorId: string, dto: CreateProposalDto) {
    return this.prisma.proposal.create({
      data: {
        channelId,
        authorId,
        title: dto.title,
        body: dto.body,
        quorum: dto.quorum,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
        status: 'DRAFT',
      },
    });
  }

  async openProposal(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'OPEN' },
    });
  }

  async closeProposal(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { votes: true },
    });

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    const yes = proposal.votes.filter((v) => v.choice === 'YES').length;
    const no = proposal.votes.filter((v) => v.choice === 'NO').length;
    const total = proposal.votes.length;

    const meetsQuorum = proposal.quorum ? total >= proposal.quorum : true;
    const hasMajority = yes > no;
    const status = meetsQuorum && hasMajority ? 'PASSED' : 'FAILED';

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status },
    });
  }

  async castVote(proposalId: string, userId: string, choice: VoteChoice) {
    return this.prisma.vote.upsert({
      where: {
        proposalId_userId: { proposalId, userId },
      },
      update: { choice },
      create: { proposalId, userId, choice },
    });
  }

  async getProposal(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { votes: true },
    });

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    const yes = proposal.votes.filter((v) => v.choice === 'YES').length;
    const no = proposal.votes.filter((v) => v.choice === 'NO').length;
    const abstain = proposal.votes.filter((v) => v.choice === 'ABSTAIN').length;
    const total = proposal.votes.length;

    const { votes: _votes, ...rest } = proposal;

    return {
      ...rest,
      voteTally: { yes, no, abstain, total },
    };
  }

  async listProposals(orgId: string, status?: string) {
    const where: any = {
      channel: { orgId },
    };

    if (status) {
      where.status = status;
    }

    return this.prisma.proposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { votes: true } },
      },
    });
  }

  // ─── Direct Messages ──────────────────────────────────────────
  // Visibility rule: a conversation shows up if it has any message in the
  // last 30 days, or has an unread message for the current user.

  async listConversations(userId: string) {
    const messages = await this.prisma.directMessage.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: AUTHOR_SELECT },
        receiver: { select: AUTHOR_SELECT },
      },
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const byCounterpart = new Map<string, { counterpart: any; lastMessage: any; unreadCount: number }>();

    for (const message of messages) {
      const isSender = message.senderId === userId;
      const counterpart = isSender ? message.receiver : message.sender;
      const existing = byCounterpart.get(counterpart.id);
      const isUnread = !isSender && !message.readAt;

      if (!existing) {
        byCounterpart.set(counterpart.id, {
          counterpart,
          lastMessage: message,
          unreadCount: isUnread ? 1 : 0,
        });
      } else if (isUnread) {
        existing.unreadCount += 1;
      }
    }

    return Array.from(byCounterpart.values())
      .filter((c) => c.unreadCount > 0 || c.lastMessage.createdAt > thirtyDaysAgo)
      .sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
  }

  async getConversation(userId: string, otherUserId: string) {
    return this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: AUTHOR_SELECT },
        receiver: { select: AUTHOR_SELECT },
      },
    });
  }

  async sendMessage(senderId: string, receiverId: string, body: string) {
    if (senderId === receiverId) {
      throw new NotFoundException('Cannot message yourself');
    }

    return this.prisma.directMessage.create({
      data: { senderId, receiverId, body },
      include: {
        sender: { select: AUTHOR_SELECT },
        receiver: { select: AUTHOR_SELECT },
      },
    });
  }

  async markConversationRead(userId: string, otherUserId: string) {
    await this.prisma.directMessage.updateMany({
      where: { senderId: otherUserId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ─── Collections (wiki) ───────────────────────────────────────

  async createCollection(orgId: string, dto: CreateCollectionDto) {
    return this.prisma.collection.create({
      data: {
        orgId,
        name: dto.name,
        emoji: dto.emoji ?? '📄',
        description: dto.description,
      },
    });
  }

  async listCollections(orgId: string) {
    return this.prisma.collection.findMany({
      where: { orgId },
      orderBy: { sortOrder: 'asc' },
      include: {
        pages: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, updatedAt: true },
        },
      },
    });
  }

  async updateCollection(collectionId: string, dto: UpdateCollectionDto) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    return this.prisma.collection.update({ where: { id: collectionId }, data: dto });
  }

  async deleteCollection(collectionId: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    await this.prisma.collection.delete({ where: { id: collectionId } });
  }

  async createPage(collectionId: string, authorId: string, dto: CreatePageDto) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    return this.prisma.collectionPage.create({
      data: { collectionId, authorId, title: dto.title, body: dto.body },
    });
  }

  async getPage(pageId: string) {
    const page = await this.prisma.collectionPage.findUnique({
      where: { id: pageId },
      include: { author: { select: AUTHOR_SELECT } },
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    return page;
  }

  async updatePage(pageId: string, dto: UpdatePageDto) {
    const page = await this.prisma.collectionPage.findUnique({ where: { id: pageId } });
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    return this.prisma.collectionPage.update({ where: { id: pageId }, data: dto });
  }

  async deletePage(pageId: string) {
    const page = await this.prisma.collectionPage.findUnique({ where: { id: pageId } });
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.prisma.collectionPage.delete({ where: { id: pageId } });
  }

  // ─── Search (⌘K) ────────────────────────────────────────────

  async search(orgId: string, query: string) {
    if (!query || query.trim().length < 2) {
      return { members: [], channels: [], events: [], pages: [] };
    }

    const q = query.trim();

    const [members, channels, events, pages] = await Promise.all([
      this.prisma.userOrg.findMany({
        where: {
          orgId,
          user: {
            OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
          },
        },
        take: 8,
        include: { user: { select: AUTHOR_SELECT } },
      }),
      this.prisma.channel.findMany({
        where: {
          orgId,
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }],
        },
        take: 8,
      }),
      this.prisma.event.findMany({
        where: { orgId, title: { contains: q, mode: 'insensitive' } },
        take: 8,
      }),
      this.prisma.collectionPage.findMany({
        where: {
          collection: { orgId },
          OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }],
        },
        take: 8,
        include: { collection: { select: { id: true, name: true, emoji: true } } },
      }),
    ]);

    return {
      members: members.map((m) => m.user),
      channels,
      events,
      pages,
    };
  }
}
