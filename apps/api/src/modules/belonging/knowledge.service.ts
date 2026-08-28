import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { BelongingSettingsService } from './belonging-settings.service';
import { DEFAULT_TEMPLATES, renderTemplate } from './belonging-emails';
import { outstandingReading, graceEndsAt } from './required-reading';

/** Roles that count as a member of the community for required reading. */
const ACTIVE_ROLES = ['ADMIN', 'STAFF', 'MEMBER'] as const;

/**
 * The Knowledge Center (PRD §6).
 *
 * A durable place for a co-op to say what it stands for, and — where it
 * chooses — a way to know that people have read it.
 *
 * **Numbering in titles is authored by hand and stays that way** (§6.1). A
 * co-op that writes "3. Guests and keys" has decided that article is third
 * for reasons of its own; generating the number would mean reordering the
 * list silently rewrote a title somebody chose.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BelongingSettingsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private webUrl(): string {
    return this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  }

  private async uniqueSlug(orgId: string, title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'article';

    for (let suffix = 0; ; suffix++) {
      const slug = suffix === 0 ? base : `${base}-${suffix}`;
      const taken = await this.prisma.knowledgeArticle.findFirst({
        where: { orgId, slug },
        select: { id: true },
      });
      if (!taken) return slug;
    }
  }

  // ─── Reading ────────────────────────────────────────────────

  /**
   * The index (§6.1).
   *
   * Drafts are admin-only. A member seeing "3 articles" where an admin sees
   * five is correct; a member seeing an unfinished article is not.
   */
  async list(orgId: string, viewerId: string, isAdmin: boolean) {
    const articles = await this.prisma.knowledgeArticle.findMany({
      where: { orgId, ...(isAdmin ? {} : { state: 'PUBLISHED' }) },
      orderBy: { position: 'asc' },
      include: {
        author: { select: { id: true, user: { select: { name: true, avatarPath: true } } } },
        _count: { select: { likes: true, comments: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, member: { select: { user: { select: { name: true } } } } },
        },
        likes: { where: { memberId: viewerId }, select: { id: true } },
        acknowledgments: { where: { memberId: viewerId }, select: { articleVersion: true } },
      },
    });

    return articles.map((a) => {
      const latestComment = a.comments[0];
      return {
        id: a.id,
        title: a.title,
        slug: a.slug,
        state: a.state,
        position: a.position,
        coverImagePath: a.coverImagePath,
        requiresAcknowledgment: a.requiresAcknowledgment,
        version: a.version,
        author: a.author
          ? { name: a.author.user.name, avatarPath: a.author.user.avatarPath }
          : null,
        likeCount: a._count.likes,
        commentCount: a._count.comments,
        likedByMe: a.likes.length > 0,
        acknowledgedByMe: a.acknowledgments.some((ack) => ack.articleVersion === a.version),
        // "Charley posted 2 years ago" or "Rasul replied 10 months ago" — the
        // reference layout's one line of life on each row.
        lastActivity: latestComment
          ? { kind: 'replied' as const, at: latestComment.createdAt, who: latestComment.member.user.name }
          : { kind: 'posted' as const, at: a.publishedAt ?? a.createdAt, who: a.author?.user.name ?? null },
      };
    });
  }

  async get(orgId: string, idOrSlug: string, viewerId: string, isAdmin: boolean) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: {
        orgId,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        ...(isAdmin ? {} : { state: 'PUBLISHED' }),
      },
      include: {
        author: { select: { user: { select: { name: true, avatarPath: true } } } },
        _count: { select: { likes: true, comments: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { member: { select: { id: true, user: { select: { name: true, avatarPath: true } } } } },
        },
        likes: { where: { memberId: viewerId }, select: { id: true } },
        acknowledgments: { where: { memberId: viewerId }, select: { articleVersion: true } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    return {
      ...article,
      likeCount: article._count.likes,
      commentCount: article._count.comments,
      likedByMe: article.likes.length > 0,
      acknowledgedByMe: article.acknowledgments.some((a) => a.articleVersion === article.version),
    };
  }

  // ─── Writing (admin) ────────────────────────────────────────

  async create(
    orgId: string,
    authorId: string,
    dto: { title: string; body: string; coverImagePath?: string; requiresAcknowledgment?: boolean },
  ) {
    const last = await this.prisma.knowledgeArticle.findFirst({
      where: { orgId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.knowledgeArticle.create({
      data: {
        orgId,
        authorId,
        title: dto.title.trim(),
        slug: await this.uniqueSlug(orgId, dto.title),
        body: dto.body,
        coverImagePath: dto.coverImagePath ?? null,
        requiresAcknowledgment: dto.requiresAcknowledgment ?? false,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  /**
   * Edit an article, and decide what that does to everyone's agreement
   * (§6.2).
   *
   * **`material` is not a detail the caller may omit** on a published,
   * required article. A typo fix that silently re-required agreement from
   * every member would be a nuisance; a change of meaning that silently kept
   * old agreements would be a co-op holding people to something they never
   * read. There is no safe default between those, so the admin is asked.
   */
  async update(
    orgId: string,
    articleId: string,
    dto: {
      title?: string;
      body?: string;
      coverImagePath?: string | null;
      requiresAcknowledgment?: boolean;
      material?: boolean;
    },
  ) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId },
    });
    if (!article) throw new NotFoundException('Article not found');

    const wasLive = article.state === 'PUBLISHED' && article.requiresAcknowledgment;
    const changesContent = dto.title !== undefined || dto.body !== undefined;

    if (wasLive && changesContent && dto.material === undefined) {
      throw new BadRequestException(
        'People have already agreed to this. Say whether this is a minor edit, which keeps their agreement, or a material change, which asks everyone to read it again.',
      );
    }

    const bump = wasLive && changesContent && dto.material === true;
    const now = new Date();

    const updated = await this.prisma.knowledgeArticle.update({
      where: { id: article.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.coverImagePath !== undefined && { coverImagePath: dto.coverImagePath }),
        ...(dto.requiresAcknowledgment !== undefined && {
          requiresAcknowledgment: dto.requiresAcknowledgment,
        }),
        ...(bump && { version: { increment: 1 }, requiredSince: now }),
      },
    });

    if (bump) {
      // Everyone gets the same email and the same fresh grace period as they
      // would for a new article, because from their side that is what it is.
      await this.notifyRequiredReading(orgId, updated.id);
    }

    return updated;
  }

  /**
   * Publish (§6.2).
   *
   * If it requires agreement, this is the moment the clock starts: existing
   * members are emailed and keep full access for the grace period, and
   * anyone joining afterwards meets it at the door.
   */
  async publish(orgId: string, articleId: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId },
    });
    if (!article) throw new NotFoundException('Article not found');
    if (article.state === 'PUBLISHED') return article;

    const now = new Date();
    const published = await this.prisma.knowledgeArticle.update({
      where: { id: article.id },
      data: {
        state: 'PUBLISHED',
        publishedAt: article.publishedAt ?? now,
        ...(article.requiresAcknowledgment && { requiredSince: now }),
      },
    });

    if (published.requiresAcknowledgment) {
      await this.notifyRequiredReading(orgId, published.id);
    }

    return published;
  }

  /**
   * Unpublish.
   *
   * `requiredSince` is cleared so nobody is gated by something they can no
   * longer read. Acknowledgments are kept: a co-op that republishes should
   * not have lost the record of who already agreed.
   */
  async unpublish(orgId: string, articleId: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.knowledgeArticle.update({
      where: { id: article.id },
      data: { state: 'DRAFT', requiredSince: null },
    });
  }

  /** Drag to reorder (§6.1). Positions are rewritten wholesale, not nudged. */
  async reorder(orgId: string, orderedIds: string[]) {
    const owned = await this.prisma.knowledgeArticle.findMany({
      where: { orgId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (owned.length !== orderedIds.length) {
      throw new BadRequestException('That list contains an article from another community');
    }

    await this.prisma.$transaction(
      orderedIds.map((id, position) =>
        this.prisma.knowledgeArticle.update({ where: { id }, data: { position } }),
      ),
    );
    return { reordered: orderedIds.length };
  }

  async remove(orgId: string, articleId: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.knowledgeArticle.delete({ where: { id: article.id } });
    return { deleted: true };
  }

  // ─── Agreement ──────────────────────────────────────────────

  /**
   * "I have read and understand this" (§6.2).
   *
   * An explicit act, never scroll depth. What is recorded is what a co-op
   * would need if the agreement were ever questioned: who, which version,
   * when, and from where.
   */
  async acknowledge(orgId: string, articleId: string, memberId: string, ip: string | null) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId, state: 'PUBLISHED' },
      select: { id: true, version: true, requiresAcknowledgment: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    // Idempotent: a double-click must not be two agreements, and the unique
    // index would otherwise turn the second one into an error on a page the
    // member has already finished with.
    return this.prisma.articleAcknowledgment.upsert({
      where: {
        articleId_articleVersion_memberId: {
          articleId: article.id,
          articleVersion: article.version,
          memberId,
        },
      },
      create: {
        articleId: article.id,
        articleVersion: article.version,
        memberId,
        ip,
      },
      update: {},
    });
  }

  /** What onboarding walks a member through, and the countdown banner. */
  async outstandingFor(orgId: string, memberId: string) {
    const settings = await this.settings.forOrg(orgId);
    if (!settings.knowledgeCenterEnabled) {
      return { blocking: [], inGrace: [], graceEndsAt: null };
    }

    const membership = await this.prisma.userOrg.findFirst({
      where: { id: memberId, orgId },
      select: { memberSince: true },
    });
    if (!membership) return { blocking: [], inGrace: [], graceEndsAt: null };

    const articles = await this.prisma.knowledgeArticle.findMany({
      where: { orgId, state: 'PUBLISHED', requiresAcknowledgment: true },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, slug: true, version: true, requiredSince: true },
    });

    const acks = await this.prisma.articleAcknowledgment.findMany({
      where: { memberId, articleId: { in: articles.map((a) => a.id) } },
      select: { articleId: true, articleVersion: true },
    });

    const acknowledgedVersions = new Map<string, number>();
    for (const ack of acks) {
      const seen = acknowledgedVersions.get(ack.articleId) ?? 0;
      if (ack.articleVersion > seen) acknowledgedVersions.set(ack.articleId, ack.articleVersion);
    }

    const outstanding = outstandingReading(
      articles,
      { memberSince: membership.memberSince, acknowledgedVersions },
      settings.requiredReadingGraceDays,
      new Date(),
    );

    return { ...outstanding, graceEndsAt: graceEndsAt(outstanding) };
  }

  // ─── Likes and comments ─────────────────────────────────────

  async toggleLike(orgId: string, articleId: string, memberId: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId, state: 'PUBLISHED' },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    const existing = await this.prisma.articleLike.findUnique({
      where: { articleId_memberId: { articleId: article.id, memberId } },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.articleLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.articleLike.create({ data: { articleId: article.id, memberId } });
    return { liked: true };
  }

  async comment(orgId: string, articleId: string, memberId: string, body: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId, state: 'PUBLISHED' },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.articleComment.create({
      data: { articleId: article.id, memberId, body: body.trim() },
      include: { member: { select: { user: { select: { name: true, avatarPath: true } } } } },
    });
  }

  async removeComment(orgId: string, commentId: string, memberId: string, isAdmin: boolean) {
    const comment = await this.prisma.articleComment.findFirst({
      where: { id: commentId, article: { orgId } },
      select: { id: true, memberId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (!isAdmin && comment.memberId !== memberId) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.articleComment.delete({ where: { id: comment.id } });
    return { deleted: true };
  }

  // ─── Compliance (§6.3) ──────────────────────────────────────

  /** Who has agreed, who has not, and a way to ask again. */
  async compliance(orgId: string, articleId: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, orgId },
      select: { id: true, title: true, version: true, requiredSince: true, requiresAcknowledgment: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    const members = await this.prisma.userOrg.findMany({
      where: { orgId, role: { in: [...ACTIVE_ROLES] } },
      select: {
        id: true,
        memberSince: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { memberSince: 'asc' },
    });

    const acks = await this.prisma.articleAcknowledgment.findMany({
      where: { articleId: article.id, articleVersion: article.version },
      select: { memberId: true, acknowledgedAt: true },
    });
    const acknowledged = new Map(acks.map((a) => [a.memberId, a.acknowledgedAt]));

    const outstanding = members.filter((m) => !acknowledged.has(m.id));

    return {
      article,
      total: members.length,
      acknowledgedCount: acknowledged.size,
      // Guarded, because a co-op with no members should read as 0%, not NaN%.
      percentage: members.length === 0 ? 0 : Math.round((acknowledged.size / members.length) * 100),
      outstanding: outstanding.map((m) => ({
        memberId: m.id,
        name: m.user.name,
        email: m.user.email,
        memberSince: m.memberSince,
      })),
    };
  }

  /** Ask again, to whoever still owes it. */
  async remind(orgId: string, articleId: string) {
    const { outstanding } = await this.compliance(orgId, articleId);
    await this.notifyRequiredReading(orgId, articleId, outstanding.map((m) => m.email));
    return { reminded: outstanding.length };
  }

  /**
   * Tell members there is something to read (§6.2).
   *
   * Sent to everyone active by default, or to a named list when an admin is
   * reminding the stragglers. Fire-and-forget per recipient: one bad address
   * must not stop the other forty.
   */
  private async notifyRequiredReading(orgId: string, articleId: string, only?: string[]) {
    const [article, org, settings, template] = await Promise.all([
      this.prisma.knowledgeArticle.findUnique({
        where: { id: articleId },
        select: { title: true, slug: true },
      }),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
      this.settings.forOrg(orgId),
      this.prisma.belongingEmailTemplate.findUnique({
        where: { orgId_kind: { orgId, kind: 'REQUIRED_READING' } },
      }),
    ]);
    if (!article || !org) return;

    const recipients =
      only ??
      (
        await this.prisma.userOrg.findMany({
          where: { orgId, role: { in: [...ACTIVE_ROLES] } },
          select: { user: { select: { email: true } } },
        })
      ).map((m) => m.user.email);

    const { subject, html } = renderTemplate(template ?? DEFAULT_TEMPLATES.REQUIRED_READING, {
      community_name: org.name,
      article_title: article.title,
      article_url: `${this.webUrl()}/portal/${org.slug}/welcome/${article.slug}`,
      grace_days: String(settings.requiredReadingGraceDays),
    });

    for (const to of recipients) {
      await this.email.sendRaw(to, subject, html);
    }

    this.logger.log(`Required reading "${article.title}" announced to ${recipients.length} member(s)`);
  }
}
