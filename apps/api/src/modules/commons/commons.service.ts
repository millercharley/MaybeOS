import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { escapeHtml } from '../../common/escape-html';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CreateCollectionDto, UpdateCollectionDto } from './dto/create-collection.dto';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import { VoteChoice } from '@prisma/client';
import { UnreadCounts } from './dto/unread.dto';
import { ThreadsService } from './threads.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../platform/audit.service';
import { groupReactions, isAllowedReaction } from './reactions';

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true, avatarPath: true } as const;


@Injectable()
export class CommonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threads: ThreadsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

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

  /**
   * Whether this caller may open a channel here (CMN-11).
   *
   * Admins always may. Everybody else may only when the co-op has turned it
   * on, which is off by default — so a co-op that has never seen this setting
   * behaves exactly as it did, with channels an organiser's job.
   *
   * The role comes from the same place `RolesGuard` reads it, rather than a
   * second lookup that could disagree with the guard sitting in front of it.
   */
  private async assertMayCreateChannel(orgId: string, role?: string) {
    if (role === 'ADMIN') return;

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { memberChannelsEnabled: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.memberChannelsEnabled) {
      throw new ForbiddenException(
        'Only admins can open a channel in this co-op.',
      );
    }
  }

  /**
   * Whether this caller may change a channel's name, emoji or section
   * (CMN-11).
   *
   * An admin may change any of them. A member may change the channel they
   * opened themselves — otherwise a member who mistypes the name of their own
   * channel has to find an organiser to fix it, which is a poor reward for
   * starting a conversation. Deleting stays admin-only: by the time a channel
   * is worth deleting, other people have written in it.
   */
  private assertMayEditChannel(
    channel: { createdById: string | null },
    userId?: string,
    role?: string,
  ) {
    if (role === 'ADMIN') return;
    if (userId && channel.createdById === userId) return;
    throw new ForbiddenException('Only an admin or the member who opened this channel can change it.');
  }

  /**
   * A section that belongs to this co-op, or NotFound (CMN-11).
   *
   * Filing a channel under another co-op's section would be a cross-tenant
   * write, so the id is resolved through the org exactly like everything else
   * here — and `null` is a legitimate value meaning "no section".
   */
  private async assertSectionInOrg(orgId: string, sectionId?: string | null) {
    if (!sectionId) return;
    const section = await this.prisma.channelSection.findFirst({
      where: { id: sectionId, orgId },
      select: { id: true },
    });
    if (!section) throw new NotFoundException('Section not found');
  }

  async createChannel(
    orgId: string,
    dto: CreateChannelDto,
    createdById?: string,
    role?: string,
  ) {
    await this.assertMayCreateChannel(orgId, role);
    await this.assertSectionInOrg(orgId, dto.sectionId);

    const slug = await this.freeChannelSlug(orgId, dto.name);

    // Appended, not inserted. A new channel goes to the end of whatever order
    // the co-op has arranged rather than jumping to the top.
    const last = await this.prisma.channel.findFirst({
      where: { orgId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.channel.create({
      data: {
        orgId,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        isPublic: dto.isPublic ?? true,
        emoji: dto.emoji?.trim() || null,
        sectionId: dto.sectionId ?? null,
        createdById: createdById ?? null,
        position: (last?.position ?? 0) + 1,
      },
    });
  }

  /**
   * A slug nothing else in this co-op is using (CMN-10).
   *
   * `(orgId, slug)` is unique, and the slug was derived from the name with no
   * check at all — so a co-op creating a second "General", or any two names
   * that flatten to the same thing ("Q&A" and "Q A"), got a Prisma unique
   * violation surfaced as a 500. Now that an admin creates channels from a
   * form rather than a seed script, that is a thing people will actually do.
   *
   * A name of nothing but punctuation flattens to an empty string, which is
   * a legal-looking slug that then collides with the next one. `channel` is
   * the fallback so the suffix loop has something to number.
   */
  private async freeChannelSlug(orgId: string, name: string, exceptId?: string) {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'channel';

    for (let suffix = 0; suffix < 100; suffix += 1) {
      const slug = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const clash = await this.prisma.channel.findFirst({
        where: { orgId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
    }

    throw new BadRequestException(
      'There are already too many channels with that name. Try a different one.',
    );
  }

  async listChannels(orgId: string) {
    return this.prisma.channel.findMany({
      where: { orgId },
      // Position first, creation date as the tie-break — so a co-op that has
      // never reordered anything keeps exactly the order it had (CMN-10).
      orderBy: [{ isPinned: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
  }

  async pinChannel(orgId: string, channelId: string, isPinned: boolean) {
    await this.findChannelInOrg(orgId, channelId);

    return this.prisma.channel.update({
      where: { id: channelId },
      data: { isPinned },
    });
  }

  /**
   * Rename a channel, or change what it says it is for (CMN-10).
   *
   * The slug follows the name, and is re-derived rather than frozen: a channel
   * renamed from "Random" to "Announcements" whose address still said `random`
   * would be a small lie in every link to it. Nothing addresses a channel by
   * slug yet — the UI uses ids — so this costs nothing today and keeps the two
   * honest if anything ever does.
   */
  async updateChannel(
    orgId: string,
    channelId: string,
    dto: {
      name?: string;
      description?: string | null;
      isPublic?: boolean;
      emoji?: string | null;
      sectionId?: string | null;
    },
    userId?: string,
    role?: string,
  ) {
    const channel = await this.findChannelInOrg(orgId, channelId);
    this.assertMayEditChannel(channel, userId, role);
    await this.assertSectionInOrg(orgId, dto.sectionId);

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) {
      throw new BadRequestException('A channel needs a name.');
    }

    return this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(name ? { name, slug: await this.freeChannelSlug(orgId, name, channelId) } : {}),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        // Empty string clears it, the same as null: an emoji picker's "none"
        // and a cleared text field should not mean two different things.
        ...(dto.emoji !== undefined && { emoji: dto.emoji?.trim() || null }),
        ...(dto.sectionId !== undefined && { sectionId: dto.sectionId }),
      },
    });
  }

  /**
   * Put the channels in the order an admin dragged them into (CMN-10).
   *
   * Takes the whole list rather than one channel and a target index: a
   * move-this-one endpoint has to renumber its neighbours anyway, and doing
   * that from two clients at once is how a list ends up with two channels
   * claiming the same position. One write of the whole order cannot disagree
   * with itself.
   *
   * Ids from another co-op are filtered out by the scoped `updateMany` rather
   * than trusted — a doctored list must not renumber somebody else's Commons.
   */
  async reorderChannels(orgId: string, channelIds: string[]) {
    await this.prisma.$transaction(
      channelIds.map((id, index) =>
        this.prisma.channel.updateMany({
          where: { id, orgId },
          data: { position: index },
        }),
      ),
    );

    return this.listChannels(orgId);
  }

  /**
   * Delete a channel, and everything written in it.
   *
   * `Post.channel` cascades, so this takes the posts, their comments and their
   * reactions with it. That is the honest behaviour — a channel is where the
   * conversation lives, not a label on it — but it means the UI has to say so
   * in numbers before anybody clicks, which is why `listChannels` carries a
   * post count.
   *
   * The default channel is refused. It is where a co-op's first post lands and
   * where anything without a home goes; deleting it leaves the Commons with no
   * floor to stand on.
   */
  async deleteChannel(orgId: string, channelId: string) {
    const channel = await this.findChannelInOrg(orgId, channelId);

    if (channel.isDefault) {
      throw new BadRequestException(
        'This is the co-op’s default channel and cannot be deleted. Rename it instead.',
      );
    }

    await this.prisma.channel.delete({ where: { id: channelId } });
    return { deleted: channelId };
  }

  /**
   * What this caller may do in this co-op's Commons (CMN-11).
   *
   * A separate authenticated route rather than a field on the org, because
   * `GET /orgs/:slug` answers the public internet — it draws the join page —
   * and how a co-op runs its Commons is not something to publish. Same
   * reasoning as the share-tracking switch, which the Members endpoint
   * reports and the public org route does not.
   */
  async commonsPermissions(orgId: string, role?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { memberChannelsEnabled: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return {
      memberChannelsEnabled: org.memberChannelsEnabled,
      canCreateChannel: role === 'ADMIN' || org.memberChannelsEnabled,
      canManageSections: role === 'ADMIN',
    };
  }

  // ─── Sections (CMN-11) ──────────────────────────────────────
  //
  // A section is a heading in the sidebar with channels under it — Circle's
  // "General". It is the co-op's own information architecture, so an admin
  // makes them; members file their channels into the ones that exist.
  //
  // Channels are not required to have one. Anything unfiled sits above the
  // first section rather than in an "Other" bucket nobody chose to create.

  async createSection(orgId: string, name: string) {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('A section needs a name.');

    // `(orgId, name)` is unique, so a second "General" is a constraint
    // violation surfaced as a 500 unless it is caught here — the same bug
    // channel slugs had before CMN-10.
    const existing = await this.prisma.channelSection.findFirst({
      where: { orgId, name: clean },
      select: { id: true },
    });
    if (existing) throw new BadRequestException(`This co-op already has a section called "${clean}".`);

    const last = await this.prisma.channelSection.findFirst({
      where: { orgId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.channelSection.create({
      data: { orgId, name: clean, position: (last?.position ?? 0) + 1 },
    });
  }

  async listSections(orgId: string) {
    return this.prisma.channelSection.findMany({
      where: { orgId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { channels: true } } },
    });
  }

  async updateSection(orgId: string, sectionId: string, name: string) {
    await this.assertSectionInOrg(orgId, sectionId);

    const clean = name.trim();
    if (!clean) throw new BadRequestException('A section needs a name.');

    const clash = await this.prisma.channelSection.findFirst({
      where: { orgId, name: clean, id: { not: sectionId } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`This co-op already has a section called "${clean}".`);

    return this.prisma.channelSection.update({
      where: { id: sectionId },
      data: { name: clean },
    });
  }

  /**
   * Remove a section. The channels in it survive, unfiled.
   *
   * `channels.sectionId` is SET NULL rather than cascading: a section is a
   * heading, and deleting a heading must never delete the conversations
   * underneath it. The count is returned so the UI can say what moved.
   */
  async deleteSection(orgId: string, sectionId: string) {
    await this.assertSectionInOrg(orgId, sectionId);

    const ungrouped = await this.prisma.channel.count({ where: { orgId, sectionId } });
    await this.prisma.channelSection.delete({ where: { id: sectionId } });

    return { deleted: sectionId, ungrouped };
  }

  /** The whole order in one write, for the same reason channels are. */
  async reorderSections(orgId: string, sectionIds: string[]) {
    await this.prisma.$transaction(
      sectionIds.map((id, index) =>
        this.prisma.channelSection.updateMany({
          where: { id, orgId },
          data: { position: index },
        }),
      ),
    );

    return this.listSections(orgId);
  }

  // ─── Inviting somebody to a channel (CMN-11) ────────────────

  /**
   * Tell other members a channel exists.
   *
   * Channels in MaybeOS are open: every member can already see every channel,
   * so this adds no access and takes none away. It is an invitation in the
   * ordinary sense — a message saying "this is here, come and talk" — and it
   * arrives as a direct message from the person inviting, because a message
   * from a name you recognise is the thing that actually gets read.
   *
   * Deliberately not silent-add-to-a-list: the sidebar already lists every
   * channel, so an "add" would change nothing the member could see, and a
   * feature that appears to do something while doing nothing is worse than
   * not having it.
   *
   * Every recipient is checked for membership of this org — the same rule
   * `sendMessage` enforces, for the same reason: a user id in a request body
   * is not evidence of anything.
   */
  async inviteToChannel(
    orgId: string,
    channelId: string,
    inviterId: string,
    userIds: string[],
    note?: string,
  ) {
    const channel = await this.findChannelInOrg(orgId, channelId);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // Yourself is not an invitation, and the same person twice is one.
    const recipients = [...new Set(userIds)].filter((id) => id !== inviterId);
    if (recipients.length === 0) {
      throw new BadRequestException('Choose at least one other member to invite.');
    }

    for (const userId of recipients) {
      await this.assertOrgMember(orgId, userId);
    }

    const label = `${channel.emoji ? `${channel.emoji} ` : '#'}${channel.name}`;
    const link = `/portal/${org.slug}/commons?channel=${channel.id}`;
    // Escaped: a channel name is written by a member, and this body is stored
    // as HTML and rendered as HTML. `renderBodyHtml` sanitises on the way out
    // too, but a body that needs sanitising to be safe is a body built wrong.
    const body =
      `<p>Come and join <a href="${link}">${escapeHtml(label)}</a> in the Commons.</p>` +
      (note?.trim() ? `<p>${escapeHtml(note.trim())}</p>` : '');

    await this.prisma.directMessage.createMany({
      data: recipients.map((receiverId) => ({ orgId, senderId: inviterId, receiverId, body })),
    });

    return { invited: recipients.length, channelId };
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

  async listPosts(
    orgId: string,
    channelId: string,
    page: number,
    perPage: number,
    viewerId?: string,
  ) {
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
          // Grouped below (CMN-20). The list returned only a *count*, so the
          // bar on a post in the feed could not say which emoji they were or
          // which were the reader's own — and pressing one had to re-read the
          // post to find out what it had just done.
          reactions: { select: { emoji: true, userId: true } },
          _count: { select: { comments: true, reactions: true } },
        },
      }),
      this.prisma.post.count({ where: { channelId } }),
    ]);

    // The same envelope every other paginated endpoint in MaybeOS returns.
    // This one used to answer `{ data, total, page, perPage }` while the web
    // client's `PaginatedResponse` declared `{ data, meta: {...} }` — so
    // `.meta.total` read `undefined` and any caller counting on it would have
    // rendered a zero rather than failing. Nothing read it until the channel
    // view needed to know whether there are older messages (CMN-11).
    return {
      // Grouped here rather than in two screens (CMN-20), and with the viewer
      // named so the bar can show which are theirs.
      data: posts.map((post) => ({
        ...post,
        // `?? []` rather than trusting the select: a post with no reactions
        // selected is an empty bar, where the alternative is a 500 that takes
        // the whole channel down with it.
        reactions: groupReactions(post.reactions ?? [], viewerId ?? ''),
      })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  /**
   * One post and its replies.
   *
   * `viewerId` so a reply's reactions can say which are the reader's own
   * (CMN-18) — a pill that cannot tell you whether you already pressed it is
   * a pill people press twice.
   */
  async getPost(orgId: string, postId: string, viewerId?: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, channel: { orgId } },
      include: {
        author: { select: AUTHOR_SELECT },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: AUTHOR_SELECT },
            // Grouped below, so a reply's emoji survive a reload (CMN-18).
            reactions: { select: { emoji: true, userId: true } },
          },
        },
        // Grouped below, like the comments' (CMN-20).
        reactions: { select: { emoji: true, userId: true } },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Comments come back flat (with parentId); nest them into a reply tree.
    const byId = new Map(
      post.comments.map((c) => [
        c.id,
        { ...c, reactions: groupReactions(c.reactions, viewerId ?? ''), replies: [] as any[] },
      ]),
    );
    const roots: any[] = [];
    for (const comment of byId.values()) {
      if (comment.parentId && byId.has(comment.parentId)) {
        byId.get(comment.parentId)!.replies.push(comment);
      } else {
        roots.push(comment);
      }
    }

    return {
      ...post,
      reactions: groupReactions(post.reactions ?? [], viewerId ?? ''),
      comments: roots,
    };
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

  /**
   * React to a post, or take it back (CMN-20).
   *
   * **A toggle that answers with the new state**, like the one on a comment
   * (CMN-17), and for the reasons that one already proved. This was an upsert
   * returning the row it wrote: pressing the same emoji twice did nothing
   * visible, and the caller learned nothing it could draw, so both screens
   * re-fetched the whole post — the admin Commons re-fetched the open thread
   * too, which is why reacting reloaded the conversation underneath you.
   *
   * Returning the grouped counts is what lets the shared `ReactionBar` show a
   * number immediately and roll back if the write fails.
   */
  async togglePostReaction(orgId: string, postId: string, userId: string, emoji: string) {
    if (!isAllowedReaction(emoji)) {
      throw new BadRequestException('A reaction has to be an emoji.');
    }

    // An unchecked write here would attach a reaction to a post in another
    // co-op, where it would then be visible to that co-op's members (SEC-04).
    await this.findPostInOrg(orgId, postId);

    const existing = await this.prisma.reaction.findUnique({
      where: { postId_userId_emoji: { postId, userId, emoji } },
    });

    if (existing) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.reaction.create({ data: { postId, userId, emoji } });
    }

    const rows = await this.prisma.reaction.findMany({
      where: { postId },
      select: { emoji: true, userId: true },
    });

    return { postId, reactions: groupReactions(rows, userId) };
  }

  /**
   * An emoji on a reply (CMN-18).
   *
   * A toggle, like the one on a message: pressing the same emoji twice means
   * "I did not mean that", and asking the caller to choose between two calls
   * is how a double tap becomes two hearts.
   */
  async toggleCommentReaction(orgId: string, commentId: string, userId: string, emoji: string) {
    if (!isAllowedReaction(emoji)) {
      throw new BadRequestException('A reaction has to be an emoji.');
    }

    // Scoped through the post to the co-op: a comment id from the request is
    // otherwise a way to react inside another tenant's conversation (SEC-04).
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, post: { channel: { orgId } } },
      select: { id: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const existing = await this.prisma.commentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId, emoji } },
    });

    if (existing) {
      await this.prisma.commentReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.commentReaction.create({ data: { commentId, userId, emoji } });
    }

    const rows = await this.prisma.commentReaction.findMany({
      where: { commentId },
      select: { emoji: true, userId: true },
    });

    return { commentId, reactions: groupReactions(rows, userId) };
  }

  // ─── Flagging ───────────────────────────────────────────────

  /**
   * Take a post down, whoever wrote it (CMN-18).
   *
   * **There was no way to remove anything from the Commons.** Flagging was the
   * only moderation there has ever been, and `isFlagged` is written and read
   * by nothing at all — a flagged post stayed exactly where it was, fully
   * visible, with nothing anywhere to show for it. The admin could delete a
   * whole channel or nothing.
   *
   * So this is a real delete rather than a flag. The comments, replies,
   * reactions and attachment rows go with it, by the cascades already in the
   * schema; the event thread does not, because `Event.post` is `SetNull` and
   * was written that way on purpose — "an event whose discussion was moderated
   * away should still exist".
   *
   * **The files go too.** The attachment rows cascade in the database and the
   * objects in the bucket do not, and a moderation delete that leaves the
   * bytes behind has not removed the thing somebody complained about — anybody
   * holding a link still has it.
   *
   * Written to the co-op's audit log (PLT-01). Removing somebody else's words
   * is the kind of power a co-op should be able to see being used.
   */
  async deletePost(
    orgId: string,
    postId: string,
    actor: { userId: string; isAdmin: boolean },
  ) {
    const post = await this.findPostInOrg(orgId, postId);

    /*
      Two ways to be allowed, and they mean different things (CMN-19).

      An admin may take down anybody's: that is the co-op removing something.
      Anyone else may take down their own, which is a person withdrawing what
      they said — the same reasoning that gives an author the edit and gives it
      to nobody else.

      Checked here rather than at the route, because the route cannot see who
      wrote it. `@Roles('ADMIN')` would have refused every author.
    */
    if (!actor.isAdmin && post.authorId !== actor.userId) {
      throw new ForbiddenException('Only the person who wrote this, or an admin, can delete it.');
    }

    /*
      Every file under this post, gathered before the rows are gone.

      Both its own attachments and its comments' — the comments cascade, which
      takes their attachment rows with them and silently leaves their objects.
    */
    const files = await this.prisma.attachment.findMany({
      where: {
        OR: [{ postId: post.id }, { comment: { postId: post.id } }],
      },
      select: { path: true },
    });

    // The row first, like every other attachment delete here: a failed object
    // delete leaves a file nobody references, which is recoverable, where the
    // reverse leaves a row rendering as a broken file, which is not.
    await this.prisma.post.delete({ where: { id: post.id } });

    for (const file of files) {
      // One failure must not strand the rest. The row is already gone, so the
      // worst case is an unreferenced object.
      await this.storage.deleteAttachment(orgId, file.path).catch(() => {});
    }

    await this.audit.record({
      orgId,
      actorId: actor.userId,
      action: 'commons.post_deleted',
      entityType: 'post',
      entityId: post.id,
      // The author and the title, not the body: enough to answer "what was
      // taken down and whose was it" without copying the thing back out.
      metadata: {
        authorId: post.authorId,
        title: post.title ?? null,
        files: files.length,
        // Whether this was moderation or somebody withdrawing their own words.
        // The same row otherwise, and they are not the same event.
        own: post.authorId === actor.userId,
      },
    });

    return { deleted: true };
  }

  /**
   * Take a comment down, whoever wrote it (CMN-18).
   *
   * Replies go with it, by the cascade on `Comment.parent` — a thread whose
   * first message is gone and whose answers remain reads as people talking to
   * nobody, and in a moderation case the replies are usually quoting the thing
   * being removed.
   */
  async deleteComment(
    orgId: string,
    commentId: string,
    actor: { userId: string; isAdmin: boolean },
  ) {
    const comment = await this.findCommentInOrg(orgId, commentId);

    // An admin, or the person who wrote it (CMN-19). See `deletePost`.
    if (!actor.isAdmin && comment.authorId !== actor.userId) {
      throw new ForbiddenException('Only the person who wrote this, or an admin, can delete it.');
    }

    /*
      Every reply beneath it, to any depth.

      A reply can itself be replied to — `getPost` builds a tree from a flat
      list — so the cascade on `Comment.parent` goes all the way down and so
      must this. Gathering only the direct replies' files would delete a
      grandchild's row and leave its object in the bucket, which on a
      moderation delete means the thing being removed is still downloadable.

      Read from the one post rather than queried per level: a thread is small,
      and this is one round trip instead of one per generation.
    */
    const siblings = await this.prisma.comment.findMany({
      where: { postId: comment.postId },
      select: { id: true, parentId: true },
    });

    const doomed = new Set([comment.id]);
    // Repeat until a pass adds nothing: the rows come back in no particular
    // order, so one sweep would miss a reply listed before its parent.
    let growing = true;
    while (growing) {
      growing = false;
      for (const row of siblings) {
        if (row.parentId && doomed.has(row.parentId) && !doomed.has(row.id)) {
          doomed.add(row.id);
          growing = true;
        }
      }
    }

    const files = await this.prisma.attachment.findMany({
      where: { commentId: { in: [...doomed] } },
      select: { path: true },
    });

    await this.prisma.comment.delete({ where: { id: comment.id } });

    for (const file of files) {
      await this.storage.deleteAttachment(orgId, file.path).catch(() => {});
    }

    await this.audit.record({
      orgId,
      actorId: actor.userId,
      action: 'commons.comment_deleted',
      entityType: 'comment',
      entityId: comment.id,
      metadata: {
        authorId: comment.authorId,
        postId: comment.postId,
        files: files.length,
        // Said out loud, because deleting one comment can remove a
        // conversation: the number is how many went with it.
        replies: doomed.size - 1,
        own: comment.authorId === actor.userId,
      },
    });

    return { deleted: true };
  }

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

  /**
   * @deprecated Superseded by thread reads (CMN-16). Kept so that anything
   * still calling it is a no-op returning the right numbers rather than a
   * 404; the unread figure comes from `thread_participants` now.
   */
  async markConversationRead(orgId: string, userId: string, otherUserId: string) {
    await this.assertOrgMember(orgId, otherUserId);

    await this.prisma.directMessage.updateMany({
      where: { orgId, senderId: otherUserId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    // The new totals, so the badge can settle without a second request. The
    // caller has just made this number smaller and is the one surface that
    // knows it; returning nothing meant the sidebar stayed wrong until the
    // next poll.
    return this.unreadCounts(orgId, userId);
  }

  // ─── What has not been read (CMN-14) ──────────────────────────

  /**
   * The two numbers behind the badges in the sidebar.
   *
   * One request for both, because they are drawn side by side and asked for
   * on a timer: two endpoints would be twice the polling for one answer, and
   * two chances for the sidebar to disagree with itself.
   *
   * **Counts, never content.** A badge needs a number. Returning the messages
   * themselves would put private conversations into a response that every
   * signed-in page fetches on an interval.
   */
  async unreadCounts(orgId: string, userId: string): Promise<UnreadCounts> {
    const [messages, commons] = await Promise.all([
      // Threads, not `direct_messages` — that table is migrated and dormant
      // (CMN-16). A group message counts the same as a one-to-one, because
      // it is the same thing with more people in it.
      this.threads.unreadMessages(orgId, userId),
      this.unreadInCommons(orgId, userId),
    ]);

    return { messages, commons };
  }

  /**
   * Posts and comments this member has not seen.
   *
   * Their own are not counted — writing something is not a thing you need to
   * go and read — and neither is anything older than the line below.
   */
  private async unreadInCommons(orgId: string, userId: string): Promise<number> {
    const [channels, reads, membership] = await Promise.all([
      this.prisma.channel.findMany({ where: { orgId }, select: { id: true } }),
      this.prisma.channelRead.findMany({
        where: { userId, channel: { orgId } },
        select: { channelId: true, lastReadAt: true },
      }),
      this.prisma.userOrg.findFirst({
        where: { userId, orgId },
        select: { memberSince: true },
      }),
    ]);
    if (channels.length === 0) return 0;

    const readAt = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));

    /*
      The line a member has read up to in a channel they have never opened.

      Not the beginning of time: MaybeItsFate imported 426 members, none of
      whom has ever opened the Commons, and counting everything ever written
      would have greeted each of them with a badge covering the co-op's whole
      history. A number that large is one nobody acts on, and a badge nobody
      acts on is a badge people learn to ignore — which costs the ones that
      matter later.

      So: the day they joined. Anything since is genuinely theirs to catch up
      on, and anything before was never addressed to them.
    */
    const joined = membership?.memberSince ?? new Date();

    const since = (channelId: string) => readAt.get(channelId) ?? joined;

    const [posts, comments] = await Promise.all([
      Promise.all(
        channels.map((c) =>
          this.prisma.post.count({
            where: { channelId: c.id, authorId: { not: userId }, createdAt: { gt: since(c.id) } },
          }),
        ),
      ),
      Promise.all(
        channels.map((c) =>
          this.prisma.comment.count({
            where: {
              post: { channelId: c.id },
              authorId: { not: userId },
              createdAt: { gt: since(c.id) },
            },
          }),
        ),
      ),
    ]);

    return [...posts, ...comments].reduce((sum, n) => sum + n, 0);
  }

  /**
   * Mark a channel read, up to now.
   *
   * Upsert rather than create-or-update: a member opening a channel for the
   * second time is the normal case, and the unique key on
   * `[userId, channelId]` is what keeps one row per member per channel when
   * two tabs do this at once.
   */
  async markChannelRead(orgId: string, userId: string, channelId: string) {
    // Scoped, not trusted: a channelId from the request that belongs to
    // another co-op would otherwise write a read marker across the tenant
    // boundary (SEC-04).
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, orgId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const lastReadAt = new Date();
    await this.prisma.channelRead.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId, lastReadAt },
      update: { lastReadAt },
    });

    return this.unreadCounts(orgId, userId);
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
