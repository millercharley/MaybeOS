import {
  BadRequestException,
  ForbiddenException,
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
import { MetaGraphService, MetaPage } from './meta-graph.service';

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
    /*
      Turning sharing off with it (SOC-02).

      Disconnecting removed the account and left `socialSharingEnabled`
      true — a flag that then meant nothing, because there was no Page to
      post to. The settings screen hid the contradiction by only offering
      the toggle once connected, and the one Share button in the product was
      somewhere most people never looked.

      SOC-02 put that button on every event screen, which would have turned
      a dormant inconsistency into a button on every public event that opens
      a dialog saying there is no Page. Reconnecting is a deliberate act and
      can turn it back on.
    */
    await this.prisma.$transaction([
      this.prisma.orgSocialAccount.deleteMany({ where: { orgId } }),
      this.prisma.organization.update({
        where: { id: orgId },
        data: { socialSharingEnabled: false },
      }),
    ]);

    return this.status(orgId);
  }

  async updateSettings(orgId: string, dto: { enabled?: boolean }) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.enabled !== undefined && { socialSharingEnabled: dto.enabled }),
      },
    });
    return this.status(orgId);
  }
}
