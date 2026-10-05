import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SUPPORT_ARTICLES } from './support-articles';

/** What an article looks like once its screenshots have signed URLs. */
export interface SupportArticleView {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: string;
  body: string;
  state: string;
  position: number;
  updatedAt: Date;
  images: { id: string; url: string | null; caption: string | null }[];
}

/**
 * MaybeOS's own documentation (PLT-05).
 *
 * Charley: "the Admin should see MaybeOS documentation on how to manage
 * everything... All Admins should see this documentation."
 *
 * Two audiences and one body of text. Every co-op's organisers read it; only
 * a platform admin writes it. That asymmetry is the whole of the access
 * model here — there is no per-co-op copy, because four hundred copies of one
 * page is four hundred pages drifting apart.
 */
@Injectable()
export class SupportService implements OnModuleInit {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Put the shipped documentation in, as the module comes up.
   *
   * This was lazy — seeded on the first read — and the cost of that only
   * became obvious when the deploy landed: the first read is an
   * *authenticated* one, so nothing exists until an organiser opens the page,
   * and nobody can confirm a deploy worked without signing in as somebody.
   * A system whose state can only be verified by a human is a system that
   * gets verified by nobody.
   *
   * One `count` per cold start is the price, and it is a few milliseconds
   * against a table that is seeded once. Deliberately not awaited and
   * deliberately swallowing failures: documentation arriving late is a
   * nuisance, an API that will not boot is an outage.
   */
  onModuleInit(): void {
    void this.seed()
      .then(({ added }) => {
        if (added > 0) this.logger.log(`Seeded ${added} support article(s)`);
      })
      .catch((error) => {
        this.logger.warn(`Could not seed support articles: ${(error as Error).message}`);
      });
  }

  /**
   * Put the shipped articles in the database, without touching edits.
   *
   * By slug, and only where the slug is missing. An article a platform admin
   * has corrected must survive the next deploy — they were looking at the
   * product when they corrected it, and this file was not.
   *
   * Idempotent, so it is safe to call on every boot, which is what makes
   * documentation arrive with a deploy rather than with somebody remembering.
   */
  async seed(): Promise<{ added: number }> {
    const existing = await this.prisma.supportArticle.findMany({ select: { slug: true } });
    const have = new Set(existing.map((a) => a.slug));

    const missing = SUPPORT_ARTICLES.filter((a) => !have.has(a.slug));
    if (missing.length === 0) return { added: 0 };

    await this.prisma.supportArticle.createMany({
      data: missing.map((a, i) => ({
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        category: a.category,
        body: a.body,
        position: have.size + i,
      })),
      skipDuplicates: true,
    });

    return { added: missing.length };
  }

  /**
   * Everything an organiser may read.
   *
   * Drafts are left out unless the reader can edit, so an article can be
   * written over several sittings without every co-op reading it half done.
   */
  async list(canEdit: boolean): Promise<SupportArticleView[]> {
    /*
      A backstop behind `onModuleInit`.

      Boot seeding is what makes the documentation appear without anybody
      opening anything; this catches the case where that boot ran before the
      database was reachable. Costs one count against a table that is empty
      exactly once.
    */
    if ((await this.prisma.supportArticle.count()) === 0) {
      await this.seed();
    }

    const articles = await this.prisma.supportArticle.findMany({
      where: canEdit ? {} : { state: 'PUBLISHED' },
      orderBy: [{ category: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      include: { images: { orderBy: { position: 'asc' } } },
    });

    return Promise.all(articles.map((a) => this.withImages(a)));
  }

  async get(slug: string, canEdit: boolean): Promise<SupportArticleView> {
    const article = await this.prisma.supportArticle.findFirst({
      where: { slug, ...(canEdit ? {} : { state: 'PUBLISHED' }) },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    if (!article) throw new NotFoundException('No such article');

    return this.withImages(article);
  }

  // ─── Writing, for a platform admin ────────────────────────────

  async create(
    userId: string,
    input: { title: string; summary?: string; category: string; body: string },
  ) {
    const last = await this.prisma.supportArticle.aggregate({
      where: { category: input.category },
      _max: { position: true },
    });

    return this.prisma.supportArticle.create({
      data: {
        slug: await this.freeSlug(input.title),
        title: input.title.trim(),
        summary: input.summary?.trim() || null,
        category: input.category,
        body: input.body,
        position: (last._max.position ?? -1) + 1,
        updatedById: userId,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    input: Partial<{ title: string; summary: string; category: string; body: string; state: string }>,
  ) {
    await this.mustExist(id);

    return this.prisma.supportArticle.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title.trim() }),
        ...(input.summary !== undefined && { summary: input.summary.trim() || null }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.state !== undefined && { state: input.state as never }),
        updatedById: userId,
      },
    });
  }

  async remove(id: string) {
    await this.mustExist(id);
    // The images go with it, by the cascade on the relation.
    return this.prisma.supportArticle.delete({ where: { id } });
  }

  /**
   * A screenshot, stored privately and signed on read.
   *
   * Takes the image as base64, the way the handbook's cover upload does —
   * browsers hand back a full `data:` URL from FileReader, so either form is
   * accepted rather than making the caller remember which.
   */
  async addImage(id: string, data: string, mimeType: string, caption?: string) {
    await this.mustExist(id);

    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');

    const path = await this.storage.uploadSupportImage(bytes, mimeType);
    const last = await this.prisma.supportArticleImage.aggregate({
      where: { articleId: id },
      _max: { position: true },
    });

    const image = await this.prisma.supportArticleImage.create({
      data: {
        articleId: id,
        path,
        caption: caption?.trim() || null,
        position: (last._max.position ?? -1) + 1,
      },
    });

    return { id: image.id, url: await this.storage.signedAttachmentUrl(path), caption: image.caption };
  }

  async removeImage(articleId: string, imageId: string) {
    // Scoped to its article rather than taken on trust from the URL (SEC-04).
    const image = await this.prisma.supportArticleImage.findFirst({
      where: { id: imageId, articleId },
    });
    if (!image) throw new NotFoundException('No such screenshot');

    await this.prisma.supportArticleImage.delete({ where: { id: image.id } });
    return { removed: true };
  }

  // ─── Shared ───────────────────────────────────────────────────

  private async withImages(article: {
    images: { id: string; path: string; caption: string | null }[];
  } & Record<string, unknown>): Promise<SupportArticleView> {
    const images = await Promise.all(
      article.images.map(async (image) => ({
        id: image.id,
        url: await this.storage.signedAttachmentUrl(image.path),
        caption: image.caption,
      })),
    );

    return { ...(article as unknown as SupportArticleView), images };
  }

  private async mustExist(id: string) {
    const article = await this.prisma.supportArticle.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('No such article');
    return article;
  }

  /** A readable slug that nothing else holds. */
  private async freeSlug(title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'article';

    for (let n = 0; n < 50; n += 1) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await this.prisma.supportArticle.findUnique({ where: { slug } });
      if (!taken) return slug;
    }
    return `${base}-${Date.now()}`;
  }
}
