import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { VoteChoice } from '@prisma/client';

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
      orderBy: { createdAt: 'asc' },
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
        author: { select: { id: true, name: true, avatarUrl: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
        reactions: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  // ─── Comments ───────────────────────────────────────────────

  async addComment(postId: string, authorId: string, body: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.prisma.comment.create({
      data: { postId, authorId, body },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
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
}
