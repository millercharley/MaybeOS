import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

/**
 * Facebook's Graph API, for connecting a co-op's Page and posting to it and to
 * the Instagram account linked to it (SOC-01).
 *
 * Plain `fetch`, no SDK: seven calls, all documented, and an SDK would be a
 * large dependency in a serverless function for less than a page of code.
 *
 * Tokens travel in the POST body, never in a URL, so they cannot end up in a
 * log line. Every call carries `appsecret_proof`, which Meta recommends: a
 * leaked Page token is then useless without the app secret as well.
 */

/** Pinned so a Meta release cannot change behaviour under us. Versions are supported for about two years. */
export const GRAPH_VERSION = 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What Facebook Login asks the admin to grant. */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];

/** One Page the admin's login manages, with its Instagram account if linked. */
export interface MetaPage {
  id: string;
  name: string;
  token: string;
  igUserId: string | null;
  igUsername: string | null;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
  }

  /** The Page token no longer works: revoked, password changed, or the app removed. */
  get tokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }
}

@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);

  constructor(private readonly config: ConfigService) {}

  private get appId() {
    return this.config.get<string>('META_APP_ID') ?? '';
  }
  private get appSecret() {
    return this.config.get<string>('META_APP_SECRET') ?? '';
  }
  get redirectUri() {
    return this.config.get<string>('META_REDIRECT_URI') ?? '';
  }

  get isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret && this.redirectUri);
  }

  private assertConfigured() {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Facebook is not set up on this server (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI).',
      );
    }
  }

  /** Where to send the admin to grant access. */
  authUrl(state: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      state,
      response_type: 'code',
      scope: META_SCOPES.join(','),
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
  }

  /**
   * Turn the code Facebook sent back into the Pages the admin manages.
   *
   * The short-lived user token is exchanged for a long-lived one first:
   * Page tokens derived from a long-lived user token do not expire, which is
   * what lets a post go out months later without anyone logging in again.
   */
  async pagesForCode(code: string): Promise<MetaPage[]> {
    this.assertConfigured();

    const short = await this.call<{ access_token: string }>('GET', '/oauth/access_token', {
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const long = await this.call<{ access_token: string }>('GET', '/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: short.access_token,
    });

    const pages = await this.call<{
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        tasks?: string[];
        instagram_business_account?: { id: string; username?: string };
      }>;
    }>(
      'GET',
      '/me/accounts',
      { fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', limit: '100' },
      long.access_token,
    );

    return pages.data
      // A Page the admin cannot post to is not a choice worth offering.
      .filter((p) => !p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE'))
      .map((p) => ({
        id: p.id,
        name: p.name,
        token: p.access_token,
        igUserId: p.instagram_business_account?.id ?? null,
        igUsername: p.instagram_business_account?.username ?? null,
      }));
  }

  /**
   * A Facebook Page post. With a picture it is a photo post, which Facebook
   * shows larger. Without one it is a link post, previewed from the event
   * page. Returns the post's id and address.
   */
  async publishToPage(
    page: { id: string; token: string },
    post: { message: string; link: string; imageUrl?: string | null },
  ): Promise<{ id: string; permalink: string | null }> {
    this.assertConfigured();

    let postId: string;
    if (post.imageUrl) {
      const photo = await this.call<{ id: string; post_id?: string }>(
        'POST',
        `/${page.id}/photos`,
        { url: post.imageUrl, message: post.message, published: 'true' },
        page.token,
      );
      postId = photo.post_id ?? photo.id;
    } else {
      const feed = await this.call<{ id: string }>(
        'POST',
        `/${page.id}/feed`,
        { message: post.message, link: post.link },
        page.token,
      );
      postId = feed.id;
    }

    const permalink = await this.call<{ permalink_url?: string }>(
      'GET',
      `/${postId}`,
      { fields: 'permalink_url' },
      page.token,
    ).then((r) => r.permalink_url ?? null, () => null);

    return { id: postId, permalink };
  }

  /**
   * An Instagram feed post: create a media container, wait for Instagram to
   * fetch the image, publish it.
   *
   * `collaborators` invites the host to co-author the post; it appears on
   * their profile once they accept in the Instagram app. An invite Instagram
   * refuses (a private account, a username that does not exist) must not
   * stop the post, so a refusal is retried once without it. The caption
   * still names them.
   */
  async publishToInstagram(
    account: { igUserId: string; token: string },
    post: { imageUrl: string; caption: string; collaborator?: string | null },
  ): Promise<{ id: string; permalink: string | null; collaboratorInvited: boolean }> {
    this.assertConfigured();

    const create = (withCollaborator: boolean) =>
      this.call<{ id: string }>(
        'POST',
        `/${account.igUserId}/media`,
        {
          image_url: post.imageUrl,
          caption: post.caption,
          ...(withCollaborator && post.collaborator
            ? { collaborators: JSON.stringify([post.collaborator]) }
            : {}),
        },
        account.token,
      );

    let container: { id: string };
    let collaboratorInvited = Boolean(post.collaborator);
    try {
      container = await create(collaboratorInvited);
    } catch (error) {
      if (!collaboratorInvited || (error instanceof MetaApiError && error.tokenInvalid)) throw error;
      this.logger.warn(`Instagram refused the collaborator invite, posting without it: ${(error as Error).message}`);
      collaboratorInvited = false;
      container = await create(false);
    }

    await this.waitUntilReady(container.id, account.token);

    const published = await this.call<{ id: string }>(
      'POST',
      `/${account.igUserId}/media_publish`,
      { creation_id: container.id },
      account.token,
    );

    const permalink = await this.call<{ permalink?: string }>(
      'GET',
      `/${published.id}`,
      { fields: 'permalink' },
      account.token,
    ).then((r) => r.permalink ?? null, () => null);

    return { id: published.id, permalink, collaboratorInvited };
  }

  /** Images are usually ready at once; this allows Instagram a few seconds. */
  private async waitUntilReady(containerId: string, token: string, attempts = 10): Promise<void> {
    for (let i = 0; i < attempts; i += 1) {
      const { status_code: status } = await this.call<{ status_code?: string }>(
        'GET',
        `/${containerId}`,
        { fields: 'status_code' },
        token,
      );
      if (!status || status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new MetaApiError(`Instagram could not process the image (${status}).`);
      }
      await sleep(this.pollDelayMs);
    }
    throw new MetaApiError('Instagram took too long to process the image.');
  }

  /** Overridable in tests. */
  pollDelayMs = 1000;

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
    accessToken?: string,
  ): Promise<T> {
    const body = new URLSearchParams(params);
    if (accessToken) {
      body.set('access_token', accessToken);
      body.set('appsecret_proof', createHmac('sha256', this.appSecret).update(accessToken).digest('hex'));
    }

    // A GET has no body, so its parameters go in the query string. The
    // token exchange puts the app secret and the one-time code there, as
    // Meta documents; neither path is logged. An access token on a GET goes
    // in the Authorization header instead.
    let url = `${GRAPH}${path}`;
    const init: RequestInit = { method, signal: AbortSignal.timeout(30_000) };
    if (method === 'GET') {
      const query = new URLSearchParams(params);
      url += `?${query}`;
      if (accessToken) {
        init.headers = { Authorization: `OAuth ${accessToken}` };
        url += `&appsecret_proof=${body.get('appsecret_proof')}`;
      }
    } else {
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = body.toString();
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new MetaApiError(`Facebook could not be reached: ${(error as Error).message}`);
    }

    const json = (await response.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!response.ok || json.error) {
      const e = json.error ?? {};
      this.logger.error(`Graph ${method} ${path} failed: ${e.code ?? response.status} ${e.message ?? ''}`);
      throw new MetaApiError(e.message ?? `Facebook answered ${response.status}`, e.code, e.error_subcode);
    }
    return json;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
