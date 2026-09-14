import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SocialPlatform } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { StorageService } from '../storage/storage.service';
import { decodeState, encodeState } from '../../common/oauth-state';
import { seal, unseal } from '../../common/secret-box';
import { MetaApiError, MetaGraphService, MetaPage } from './meta-graph.service';
import { defaultBody, facebookMessage, instagramCaption } from './social-caption';
import { IG_MAX_RATIO, IG_MIN_RATIO, jpegSize } from './jpeg-size';

/** A share still marked PENDING after this long is treated as abandoned. */
const STALE_PENDING_MS = 5 * 60 * 1000;
/** Posts per co-op per day. Far above "a few a day", far below Instagram's 100. */
export const DAILY_POST_LIMIT = 25;
/** How long an admin has to pick a Page after Facebook sends them back. */
const PICK_WINDOW_MS = 15 * 60 * 1000;

export interface Actor {
  userId: string;
  /** ADMIN or STAFF in this org, or a platform admin. */
  staff: boolean;
}

export interface ShareResult {
  platform: SocialPlatform;
  ok: boolean;
  permalink?: string | null;
  error?: string;
  alreadyShared?: boolean;
  collaboratorInvited?: boolean;
}

/**
 * Sharing a co-op's public events to its Facebook Page and Instagram (SOC-01).
 *
 * Charley: no admin approval. An admin can switch any member's sharing off,
 * or on. The rules that stand in for approval:
 * - only a published, public, upcoming, uncancelled event;
 * - only its host, or an admin or staff member;
 * - only a member allowed to share;
 * - once per event per platform;
 * - a daily limit per co-op.
 * Every post credits the host and links to the event page, added after
 * whatever the host wrote.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGraphService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  // ── Connecting the co-op's accounts (admins) ────────────────────────────

  async status(orgId: string) {
    const [org, account] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { socialSharingEnabled: true, socialShareMembersByDefault: true },
      }),
      this.prisma.orgSocialAccount.findUnique({
        where: { orgId },
        select: {
          pageId: true,
          pageName: true,
          igUsername: true,
          igUserId: true,
          pendingPages: true,
          pendingUntil: true,
          connectedAt: true,
        },
      }),
    ]);
    if (!org) throw new NotFoundException('Organization not found');

    const pending =
      account?.pendingPages && account.pendingUntil && account.pendingUntil > new Date()
        ? (unseal<MetaPage[]>(account.pendingPages) ?? []).map(({ id, name, igUsername }) => ({ id, name, igUsername }))
        : null;

    return {
      configured: this.meta.isConfigured,
      enabled: org.socialSharingEnabled,
      membersByDefault: org.socialShareMembersByDefault,
      connection: account?.pageId
        ? {
            pageName: account.pageName,
            instagramUsername: account.igUserId ? account.igUsername : null,
            connectedAt: account.connectedAt,
          }
        : null,
      pendingPages: pending,
    };
  }

  async connectUrl(orgId: string, userId: string): Promise<{ url: string }> {
    const state = encodeState(
      { orgId, userId, issuedAt: Date.now(), flow: 'meta' },
      this.config.get<string>('JWT_SECRET') ?? '',
    );
    return { url: this.meta.authUrl(state) };
  }

  /**
   * Facebook sent the admin back. Returns where to send them next.
   *
   * The state proves this server started the flow, for this org, for this
   * admin, within ten minutes. They must still be an admin now.
   */
  async handleCallback(
    code: string,
    rawState: string,
  ): Promise<{ orgSlug: string; outcome: 'connected' | 'pick' | 'nopages' }> {
    const state = decodeState(rawState, this.config.get<string>('JWT_SECRET') ?? '');
    if (!state || state.flow !== 'meta') throw new ForbiddenException('That sign-in link has expired. Start again.');

    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId: state.orgId, userId: state.userId, role: 'ADMIN' },
      select: { org: { select: { slug: true } } },
    });
    if (!membership) throw new ForbiddenException('Only an admin can connect Facebook.');

    const pages = await this.meta.pagesForCode(code);
    const orgSlug = membership.org.slug;

    if (pages.length === 0) return { orgSlug, outcome: 'nopages' };
    if (pages.length === 1) {
      await this.saveConnection(state.orgId, pages[0], state.userId);
      return { orgSlug, outcome: 'connected' };
    }

    await this.prisma.orgSocialAccount.upsert({
      where: { orgId: state.orgId },
      create: {
        orgId: state.orgId,
        pendingPages: seal(pages) as unknown as Prisma.InputJsonValue,
        pendingUntil: new Date(Date.now() + PICK_WINDOW_MS),
        connectedById: state.userId,
      },
      update: {
        pendingPages: seal(pages) as unknown as Prisma.InputJsonValue,
        pendingUntil: new Date(Date.now() + PICK_WINDOW_MS),
      },
    });
    return { orgSlug, outcome: 'pick' };
  }

  /** The admin's choice, when their login manages more than one Page. */
  async choosePage(orgId: string, pageId: string, userId: string) {
    const account = await this.prisma.orgSocialAccount.findUnique({
      where: { orgId },
      select: { pendingPages: true, pendingUntil: true },
    });
    const pages =
      account?.pendingPages && account.pendingUntil && account.pendingUntil > new Date()
        ? unseal<MetaPage[]>(account.pendingPages) ?? []
        : [];
    const page = pages.find((p) => p.id === pageId);
    if (!page) throw new BadRequestException('That choice has expired. Connect Facebook again.');

    await this.saveConnection(orgId, page, userId);
    return this.status(orgId);
  }

  private async saveConnection(orgId: string, page: MetaPage, userId: string) {
    const data = {
      pageId: page.id,
      pageName: page.name,
      pageToken: seal(page.token) as unknown as Prisma.InputJsonValue,
      igUserId: page.igUserId,
      igUsername: page.igUsername,
      pendingPages: Prisma.DbNull,
      pendingUntil: null,
      connectedById: userId,
      connectedAt: new Date(),
    };
    await this.prisma.orgSocialAccount.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
  }

  /** Forget the Page and its token. Posts already made stay where they are. */
  async disconnect(orgId: string) {
    await this.prisma.orgSocialAccount.deleteMany({ where: { orgId } });
    return this.status(orgId);
  }

  async updateSettings(orgId: string, dto: { enabled?: boolean; membersByDefault?: boolean }) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.enabled !== undefined && { socialSharingEnabled: dto.enabled }),
        ...(dto.membersByDefault !== undefined && { socialShareMembersByDefault: dto.membersByDefault }),
      },
    });
    return this.status(orgId);
  }

  /** True or false decides for this member; null returns them to the co-op's default. */
  async setMemberAllowed(orgId: string, userId: string, allowed: boolean | null) {
    const { count } = await this.prisma.userOrg.updateMany({
      where: { orgId, userId },
      data: { socialShareAllowed: allowed },
    });
    if (count === 0) throw new NotFoundException('Member not found in this organization');
    return { userId, socialShareAllowed: allowed };
  }

  // ── Sharing an event (hosts) ────────────────────────────────────────────

  /** What the share dialog needs: whether sharing is possible, why not, and what was shared already. */
  async shareOptions(orgId: string, eventId: string, actor: Actor) {
    const ctx = await this.load(orgId, eventId, actor);
    const reason = this.blockReason(ctx, actor);

    const posts = await this.prisma.eventSocialPost.findMany({
      where: { eventId, status: 'PUBLISHED' },
      select: { platform: true, permalink: true, createdAt: true },
    });
    const postFor = (platform: SocialPlatform) => posts.find((p) => p.platform === platform) ?? null;

    const credit = { body: '', hostName: ctx.hostName, instagramHandle: ctx.hostHandle, eventUrl: ctx.eventUrl };

    return {
      canShare: reason === null,
      reason,
      facebook: ctx.account?.pageId ? { pageName: ctx.account.pageName, post: postFor('FACEBOOK') } : null,
      instagram: ctx.account?.igUserId
        ? { username: ctx.account.igUsername, post: postFor('INSTAGRAM'), needsImage: !ctx.event.imageUrl }
        : null,
      imageUrl: ctx.event.imageUrl,
      body: defaultBody({
        title: ctx.event.title,
        startTime: ctx.event.startTime,
        timezone: ctx.event.timezone,
        locationName: ctx.event.location?.name ?? null,
        description: ctx.event.description,
      }),
      // What is added after the body, so the dialog can show it.
      facebookCredit: facebookMessage(credit),
      instagramCredit: instagramCaption(credit),
      credit: { hostName: ctx.hostName, instagramHandle: ctx.hostHandle },
    };
  }

  async share(
    orgId: string,
    eventId: string,
    actor: Actor,
    dto: { platforms: SocialPlatform[]; body: string; image?: string },
  ): Promise<{ results: ShareResult[] }> {
    const ctx = await this.load(orgId, eventId, actor);
    const reason = this.blockReason(ctx, actor);
    if (reason) throw new ForbiddenException(reason);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await this.prisma.eventSocialPost.count({ where: { orgId, createdAt: { gte: since } } });
    if (today + dto.platforms.length > DAILY_POST_LIMIT) {
      throw new HttpException(
        `This co-op has shared ${today} posts in the last 24 hours. The limit is ${DAILY_POST_LIMIT}; try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // The JPEG is checked before anything is posted, so a bad picture does
    // not leave Facebook posted and Instagram not.
    let jpegUrl: string | null = null;
    if (dto.image) {
      const buffer = Buffer.from(dto.image.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
      const size = jpegSize(buffer);
      if (!size) throw new BadRequestException('The picture for Instagram must be a JPEG.');
      const ratio = size.width / size.height;
      if (ratio < IG_MIN_RATIO - 0.01 || ratio > IG_MAX_RATIO + 0.01) {
        throw new BadRequestException('Instagram needs a picture between 4:5 (portrait) and 1.91:1 (landscape).');
      }
      if (size.width < 320) throw new BadRequestException('The picture is too small for Instagram (320 pixels wide at least).');
      jpegUrl = await this.storage.uploadSocialImage(orgId, buffer);
    }

    const token = unseal<string>(ctx.account!.pageToken);
    const input = { body: dto.body, hostName: ctx.hostName, instagramHandle: ctx.hostHandle, eventUrl: ctx.eventUrl };

    const results: ShareResult[] = [];
    for (const platform of dto.platforms) {
      results.push(
        await this.shareTo(platform, ctx, actor, async () => {
          if (platform === 'FACEBOOK') {
            const post = await this.meta.publishToPage(
              { id: ctx.account!.pageId!, token: token! },
              { message: facebookMessage(input), link: ctx.eventUrl, imageUrl: jpegUrl ?? ctx.event.imageUrl },
            );
            return { ...post, collaboratorInvited: undefined };
          }
          if (!ctx.account!.igUserId) throw new BadRequestException('No Instagram account is linked to the Page.');
          if (!jpegUrl) throw new BadRequestException('Instagram needs a picture. Add one to the event first.');
          return this.meta.publishToInstagram(
            { igUserId: ctx.account!.igUserId, token: token! },
            { imageUrl: jpegUrl, caption: instagramCaption(input), collaborator: ctx.hostHandle },
          );
        }),
      );
    }

    return { results };
  }

  /** Claims the event's slot for this platform, posts, and records the link, or frees the slot on failure. */
  private async shareTo(
    platform: SocialPlatform,
    ctx: ShareContext,
    actor: Actor,
    publish: () => Promise<{ id: string; permalink: string | null; collaboratorInvited?: boolean }>,
  ): Promise<ShareResult> {
    let claim: { id: string };
    try {
      claim = await this.prisma.eventSocialPost.create({
        data: { orgId: ctx.event.orgId, eventId: ctx.event.id, platform, postedById: actor.userId },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await this.prisma.eventSocialPost.findUnique({
        where: { eventId_platform: { eventId: ctx.event.id, platform } },
      });
      if (existing?.status === 'PUBLISHED') {
        return { platform, ok: false, alreadyShared: true, permalink: existing.permalink, error: 'Already shared.' };
      }
      if (existing && Date.now() - existing.updatedAt.getTime() < STALE_PENDING_MS) {
        return { platform, ok: false, error: 'This is being shared right now.' };
      }
      // Abandoned: a function that timed out mid-post. Take it over.
      if (existing) await this.prisma.eventSocialPost.delete({ where: { id: existing.id } });
      return this.shareTo(platform, ctx, actor, publish);
    }

    try {
      const post = await publish();
      await this.prisma.eventSocialPost.update({
        where: { id: claim.id },
        data: { status: 'PUBLISHED', externalId: post.id, permalink: post.permalink },
      });
      return { platform, ok: true, permalink: post.permalink, collaboratorInvited: post.collaboratorInvited };
    } catch (error) {
      await this.prisma.eventSocialPost.delete({ where: { id: claim.id } }).catch(() => undefined);
      const message =
        error instanceof MetaApiError && error.tokenInvalid
          ? 'The Facebook connection has expired. Ask an admin to reconnect it in Settings.'
          : error instanceof HttpException
            ? error.message
            : error instanceof MetaApiError
              ? `${platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'} refused the post: ${error.message}`
              : 'The post could not be made just now.';
      this.logger.error(`Share of event ${ctx.event.id} to ${platform} failed: ${(error as Error).message}`);
      return { platform, ok: false, error: message };
    }
  }

  // ── Rules ───────────────────────────────────────────────────────────────

  private async load(orgId: string, eventId: string, actor: Actor): Promise<ShareContext> {
    const [event, org, account, membership] = await Promise.all([
      this.prisma.event.findFirst({
        where: { id: eventId, orgId },
        select: {
          id: true,
          orgId: true,
          slug: true,
          title: true,
          description: true,
          startTime: true,
          endTime: true,
          timezone: true,
          isPublished: true,
          canceledAt: true,
          visibility: true,
          hostId: true,
          imageUrl: true,
          location: { select: { name: true } },
          host: { select: { name: true } },
        },
      }),
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { slug: true, name: true, socialSharingEnabled: true, socialShareMembersByDefault: true },
      }),
      this.prisma.orgSocialAccount.findUnique({
        where: { orgId },
        // The token is omitted at the client; this select is the one place it is read.
        select: { pageId: true, pageName: true, pageToken: true, igUserId: true, igUsername: true },
      }),
      this.prisma.userOrg.findFirst({
        where: { orgId, userId: actor.userId },
        select: { role: true, socialShareAllowed: true },
      }),
    ]);
    if (!event || !org) throw new NotFoundException('Event not found');

    const hostMembership = event.hostId
      ? await this.prisma.userOrg.findFirst({
          where: { orgId, userId: event.hostId },
          select: { instagramHandle: true },
        })
      : null;

    const web = (this.config.get<string>('WEB_URL') || this.config.get<string>('APP_URL') || 'https://maybeos.org')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');

    return {
      event,
      org,
      account,
      membership,
      hostName: event.host?.name?.trim() || org.name,
      hostHandle: hostMembership?.instagramHandle ?? null,
      eventUrl: `${web}/portal/${org.slug}/events/${event.slug}`,
    };
  }

  /** Why this person cannot share this event, in words for them, or null. */
  blockReason(ctx: ShareContext, actor: Actor): string | null {
    const { event, org, account, membership } = ctx;

    if (!org.socialSharingEnabled) return 'This co-op has not turned on sharing to Facebook and Instagram.';
    if (!account?.pageId || !account.pageToken) return 'This co-op has not connected a Facebook Page yet.';
    if (!actor.staff && event.hostId !== actor.userId) return 'Only the host can share this event.';
    if (!actor.staff) {
      if (!membership || membership.role === 'GUEST') return 'Only members can share events.';
      const allowed = membership.socialShareAllowed ?? org.socialShareMembersByDefault;
      if (!allowed) return 'Sharing to Facebook and Instagram is turned off for you in this co-op.';
    }
    if (!event.isPublished) return 'Publish the event before sharing it.';
    if (event.canceledAt) return 'This event is canceled.';
    if (event.visibility !== 'PUBLIC') return 'Only public events can be shared.';
    if ((event.endTime ?? event.startTime) < new Date()) return 'This event has already happened.';
    return null;
  }
}

export interface ShareContext {
  event: {
    id: string;
    orgId: string;
    slug: string;
    title: string;
    description: string | null;
    startTime: Date;
    endTime: Date | null;
    timezone: string | null;
    isPublished: boolean;
    canceledAt: Date | null;
    visibility: string;
    hostId: string | null;
    imageUrl: string | null;
    location: { name: string } | null;
    host: { name: string | null } | null;
  };
  org: { slug: string; name: string; socialSharingEnabled: boolean; socialShareMembersByDefault: boolean };
  account: {
    pageId: string | null;
    pageName: string | null;
    pageToken: Prisma.JsonValue | null;
    igUserId: string | null;
    igUsername: string | null;
  } | null;
  membership: { role: string; socialShareAllowed: boolean | null } | null;
  hostName: string;
  hostHandle: string | null;
  eventUrl: string;
}
