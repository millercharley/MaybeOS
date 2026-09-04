import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CreateCollectionDto, UpdateCollectionDto } from './dto/create-collection.dto';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import { VoteChoice } from '@prisma/client';

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true, avatarPath: true } as const;

@Injectable()
export class CommonsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Org scoping (CMN-07) ───────────────────────────────────
  //
  // Every method below that takes an entity id also takes the `orgId` from
  // the route, and resolves the entity *through* its org rather than by id
  // alone. `OrgMembershipGuard` only proves the caller belongs to the org
  // named in the URL — and the caller writes the URL. Before this, pairing
  // your own org id with somebody else's post, comment, proposal, collection
  // or page id was enough to read it, edit it, delete it or vote on it.
  //
  // Nothing here has an org column of its own except Channel and Collection,
  // so the rest are reached along their ownership chain:
  //
  //   Post           -> channel.orgId
  //   Comment        -> post.channel.orgId
  //   Proposal       -> channel.orgId
  //   CollectionPage -> collection.orgId
  //
  // A miss and a wrong-org hit both raise NotFound, deliberately
  // indistinguishable, so a 403 can't be used to confirm that an id exists
  // somewhere in the system. Same choice as SpaceOS bookings (SPC-02),
  // ImpactOS surveys (IMP-01) and D-009.

  private async findChannelInOrg(orgId: string, channelId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, orgId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  private async findPostInOrg(orgId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, channel: { orgId } },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private async findCommentInOrg(orgId: string, commentId: string) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, post: { channel: { orgId } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private async findProposalInOrg(orgId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, channel: { orgId } },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    return proposal;
  }

  private async findCollectionInOrg(orgId: string, collectionId: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id: collectionId, orgId },
    });
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  private async findPageInOrg(orgId: string, pageId: string) {
    const page = await this.prisma.collectionPage.findFirst({
      where: { id: pageId, collection: { orgId } },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  /**
   * Direct messages are the awkward case: `DirectMessage` has a sender and a
   * receiver and no org at all, so the `orgs/:orgId` segment on those routes
   * was purely decorative — any authenticated user could message any user in
   * the system by id, across co-ops.
   *
   * Enforced at the boundary instead: the other party must be a member of the
   * org in the path. That is a real restriction rather than a data fix — a
   * conversation still has no org of its own, so two people who share two
   * co-ops have one shared thread, not two. Putting an org on the message is a
   * schema decision and is not made here.
   */
  private async assertOrgMember(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Member not found in this organization');
  }

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

  async pinChannel(orgId: string, channelId: string, isPinned: boolean) {
    await this.findChannelInOrg(orgId, channelId);

    return this.prisma.channel.update({
      where: { id: channelId },
      data: { isPinned },
    });
  }

  // ─── Posts ──────────────────────────────────────────────────

  async createPost(orgId: string, channelId: string, authorId: string, dto: CreatePostDto) {
    // Previously unchecked entirely: this would happily write a post into
    // another co-op's channel.
    await this.findChannelInOrg(orgId, channelId);

    return this.prisma.post.create({
      data: {
        channelId,
        authorId,
        title: dto.title,
        body: dto.body,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  async listPosts(orgId: string, channelId: string, page: number, perPage: number) {
    await this.findChannelInOrg(orgId, channelId);

    const skip = (page - 1) * perPage;

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: {
          author: { select: AUTHOR_SELECT },
          _count: { select: { comments: true, reactions: true } },
        },
      }),
      this.prisma.post.count({ where: { channelId } }),
    ]);

    return { data: posts, total, page, perPage };
  }

  async getPost(orgId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, channel: { orgId } },
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

  async addComment(
    orgId: string,
    postId: string,
    authorId: string,
    body: string,
    parentId?: string,
  ) {
    await this.findPostInOrg(orgId, postId);

    if (parentId) {
      // tenant-scoping-exempt: the post above is already scoped to the org,
      // and the parent is then required to belong to that same post.
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

  async addReaction(orgId: string, postId: string, userId: string, emoji: string) {
    // An unchecked upsert here would attach a reaction to a post in another
    // co-op, where it would then be visible to that co-op's members.
    await this.findPostInOrg(orgId, postId);

    return this.prisma.reaction.upsert({
      where: {
        postId_userId_emoji: { postId, userId, emoji },
      },
      update: {},
      create: { postId, userId, emoji },
    });
  }

  async removeReaction(orgId: string, postId: string, userId: string, emoji: string) {
    await this.findPostInOrg(orgId, postId);

    await this.prisma.reaction.deleteMany({
      where: { postId, userId, emoji },
    });
  }

  // ─── Flagging ───────────────────────────────────────────────

  async flagPost(orgId: string, postId: string) {
    await this.findPostInOrg(orgId, postId);

    return this.prisma.post.update({
      where: { id: postId },
      data: { isFlagged: true },
    });
  }

  /**
   * Let an author rewrite what they said (CMN-09).
   *
   * Two checks, in this order and both required. `findCommentInOrg` scopes the
   * row to this co-op (SEC-04) — without it, a comment id from another co-op
   * would be editable by anybody who could guess one. Then authorship: a
   * member of the right co-op is still not the person who wrote it.
   *
   * `editedAt` is stamped here and nowhere else, so the "edited" marker a
   * thread shows means somebody changed their words rather than that any write
   * touched the row.
   */
  async editComment(orgId: string, commentId: string, userId: string, body: string) {
    const comment = await this.findCommentInOrg(orgId, commentId);

    if (comment.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  async flagComment(orgId: string, commentId: string) {
    await this.findCommentInOrg(orgId, commentId);

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { isFlagged: true },
    });
  }

  // ─── Proposals ──────────────────────────────────────────────

  async createProposal(
    orgId: string,
    channelId: string,
    authorId: string,
    dto: CreateProposalDto,
  ) {
    await this.findChannelInOrg(orgId, channelId);

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

  async openProposal(orgId: string, proposalId: string) {
    await this.findProposalInOrg(orgId, proposalId);

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: 'OPEN' },
    });
  }

  /**
   * Tally a proposal and record the outcome.
   *
   * `orgId` is required rather than optional even though the scheduler
   * (D-022) calls this for proposals across every org: the scheduler reads
   * each proposal's own `channel.orgId` and passes it back in. Making it
   * optional "for the scheduler" would leave exactly one unscoped path into
   * this method, which is how the original hole existed.
   */
  async closeProposal(orgId: string, proposalId: string) {
    await this.findProposalInOrg(orgId, proposalId);

    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { votes: true },
    });

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

  /**
   * Record a vote.
   *
   * Two things were missing, and both matter more here than elsewhere in
   * CommonsOS because this is the module's governance surface:
   *
   * - The proposal was resolved by id alone, so a member of one co-op could
   *   vote in another co-op's decision.
   * - There was no state check at all. A vote was accepted on a DRAFT
   *   proposal nobody had opened yet, on one already closed and tallied, and
   *   on one whose `closesAt` had long passed — silently changing the record
   *   behind a decision that had already been announced.
   */
  async castVote(orgId: string, proposalId: string, userId: string, choice: VoteChoice) {
    const proposal = await this.findProposalInOrg(orgId, proposalId);

    if (proposal.status !== 'OPEN') {
      throw new BadRequestException(
        `This proposal is not open for voting (status: ${proposal.status})`,
      );
    }

    if (proposal.closesAt && proposal.closesAt <= new Date()) {
      // The scheduler closes these within fifteen minutes (D-022), but a vote
      // landing inside that window must still be refused — the deadline is the
      // deadline, not "whenever the job next ran".
      throw new BadRequestException('Voting on this proposal has closed');
    }

    return this.prisma.vote.upsert({
      where: {
        proposalId_userId: { proposalId, userId },
      },
      update: { choice },
      create: { proposalId, userId, choice },
    });
  }

  async getProposal(orgId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, channel: { orgId } },
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

    const proposals = await this.prisma.proposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        votes: { select: { choice: true } },
      },
    });

    // The list returns the same `voteTally` shape as getProposal (OPS-05).
    // It previously returned only `_count.votes` — a total with no breakdown —
    // so every card that wanted "68% yes" had nothing to compute it from and
    // rendered 0%. Returning the same shape from both endpoints also stops the
    // two drifting apart, which is how the list came to disagree with the
    // detail view in the first place.
    return proposals.map(({ votes, ...proposal }) => ({
      ...proposal,
      voteTally: {
        yes: votes.filter((v) => v.choice === 'YES').length,
        no: votes.filter((v) => v.choice === 'NO').length,
        abstain: votes.filter((v) => v.choice === 'ABSTAIN').length,
        total: votes.length,
      },
    }));
  }

  // ─── Direct Messages ──────────────────────────────────────────
  //
  // Every query below filters on `orgId` (CMN-08). The org is on the message
  // itself now, so a conversation belongs to one co-op rather than to a pair
  // of people: two members who share two co-ops hold two separate threads,
  // and nothing from one is reachable from the other's URL.
  //
  // The membership checks are kept alongside the filters on purpose. The
  // filter stops another org's messages being *read*; the check stops a new
  // one being *addressed* to somebody outside this org, which no filter on
  // existing rows can catch.
  //
  // Visibility rule: a conversation shows up if it has any message in the
  // last 30 days, or has an unread message for the current user.

  async listConversations(orgId: string, userId: string) {
    const messages = await this.prisma.directMessage.findMany({
      where: { orgId, OR: [{ senderId: userId }, { receiverId: userId }] },
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

  async getConversation(orgId: string, userId: string, otherUserId: string) {
    await this.assertOrgMember(orgId, otherUserId);

    return this.prisma.directMessage.findMany({
      where: {
        orgId,
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

  async sendMessage(orgId: string, senderId: string, receiverId: string, body: string) {
    if (senderId === receiverId) {
      throw new BadRequestException('Cannot message yourself');
    }

    // Both parties must belong to this org. The sender is already proven by
    // OrgMembershipGuard; the recipient is checked here, because a filter on
    // existing rows cannot stop a message being addressed outside the org.
    await this.assertOrgMember(orgId, receiverId);

    return this.prisma.directMessage.create({
      data: { orgId, senderId, receiverId, body },
      include: {
        sender: { select: AUTHOR_SELECT },
        receiver: { select: AUTHOR_SELECT },
      },
    });
  }

  async markConversationRead(orgId: string, userId: string, otherUserId: string) {
    await this.assertOrgMember(orgId, otherUserId);

    await this.prisma.directMessage.updateMany({
      where: { orgId, senderId: otherUserId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ─── Collections (wiki) ───────────────────────────────────────

  /** One past the last, so a new section appends. */
  private async nextCollectionOrder(orgId: string): Promise<number> {
    const last = await this.prisma.collection.findFirst({
      where: { orgId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }

  /** One past the last page in this collection. */
  private async nextPageOrder(collectionId: string): Promise<number> {
    const last = await this.prisma.collectionPage.findFirst({
      where: { collectionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }

  async createCollection(orgId: string, dto: CreateCollectionDto) {
    return this.prisma.collection.create({
      data: {
        orgId,
        name: dto.name,
        emoji: dto.emoji ?? '📄',
        // Appended rather than dropped at 0, so adding a section to a handbook
        // does not silently land it at the top above "You BELONG".
        sortOrder: dto.sortOrder ?? (await this.nextCollectionOrder(orgId)),
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

  async updateCollection(orgId: string, collectionId: string, dto: UpdateCollectionDto) {
    await this.findCollectionInOrg(orgId, collectionId);

    return this.prisma.collection.update({ where: { id: collectionId }, data: dto });
  }

  async deleteCollection(orgId: string, collectionId: string) {
    // Cascades to every page in the collection, so an unscoped id here let an
    // admin of one co-op delete another co-op's entire wiki section.
    await this.findCollectionInOrg(orgId, collectionId);

    await this.prisma.collection.delete({ where: { id: collectionId } });
  }

  async createPage(orgId: string, collectionId: string, authorId: string, dto: CreatePageDto) {
    await this.findCollectionInOrg(orgId, collectionId);

    return this.prisma.collectionPage.create({
      data: {
        collectionId,
        authorId,
        title: dto.title,
        body: dto.body,
        sortOrder: dto.sortOrder ?? (await this.nextPageOrder(collectionId)),
      },
    });
  }

  async getPage(orgId: string, pageId: string) {
    const page = await this.prisma.collectionPage.findFirst({
      where: { id: pageId, collection: { orgId } },
      include: { author: { select: AUTHOR_SELECT } },
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    return page;
  }

  async updatePage(orgId: string, pageId: string, dto: UpdatePageDto) {
    await this.findPageInOrg(orgId, pageId);

    return this.prisma.collectionPage.update({ where: { id: pageId }, data: dto });
  }

  async deletePage(orgId: string, pageId: string) {
    await this.findPageInOrg(orgId, pageId);

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
