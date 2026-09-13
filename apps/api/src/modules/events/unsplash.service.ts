import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Unsplash, for picking an event's picture (EVT-22).
 *
 * Proxied rather than called from the browser, for two reasons. The access
 * key is a credential — in the browser it is in every reader's devtools and
 * anybody can spend MaybeOS's rate limit on their own site. And Unsplash's
 * terms attach obligations to *using* the API, which a server can keep and a
 * scattering of client code cannot: hotlink their CDN rather than rehosting,
 * credit the photographer, and tell them when a photo is used.
 *
 * Unconfigured is a normal state, not an error: `UNSPLASH_ACCESS_KEY` is not
 * set on a fresh install, and the picker simply does not offer the tab. A
 * co-op that has not signed up for a developer key still gets upload and URL.
 */

const API = 'https://api.unsplash.com';

/** What the picker needs to show a photo and credit it properly. */
export interface UnsplashPhoto {
  id: string;
  description: string;
  /** ~1080px wide — the size an event page actually renders. */
  url: string;
  thumbUrl: string;
  photographer: string;
  photographerUrl: string;
  /**
   * Unsplash's per-photo endpoint to call when somebody uses this one. Handed
   * to the client and handed back on selection rather than looked up again,
   * because it is the response's own value and inventing the address from the
   * id would be guessing at their API.
   */
  downloadLocation: string;
}

@Injectable()
export class UnsplashService {
  private readonly logger = new Logger(UnsplashService.name);
  private readonly key = process.env.UNSPLASH_ACCESS_KEY?.trim();

  /**
   * The UTM parameters Unsplash asks every application to append to the
   * links it shows. `utm_source` is meant to be the application name as
   * registered with them.
   */
  private readonly utm = `utm_source=${encodeURIComponent(
    process.env.UNSPLASH_APP_NAME?.trim() || 'MaybeOS',
  )}&utm_medium=referral`;

  get isConfigured(): boolean {
    return Boolean(this.key);
  }

  private get headers() {
    return {
      Authorization: `Client-ID ${this.key}`,
      'Accept-Version': 'v1',
    };
  }

  async search(query: string, page = 1): Promise<{ photos: UnsplashPhoto[] }> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Unsplash is not set up on this server (UNSPLASH_ACCESS_KEY).',
      );
    }

    const clean = query.trim();
    if (!clean) return { photos: [] };

    const url =
      `${API}/search/photos?query=${encodeURIComponent(clean)}` +
      `&per_page=24&page=${Math.max(1, Math.min(page, 20))}&orientation=landscape`;

    let response: Response;
    try {
      response = await fetch(url, { headers: this.headers });
    } catch (error) {
      this.logger.error(`Unsplash search failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Could not reach Unsplash just now.');
    }

    if (!response.ok) {
      // 403 from Unsplash is the rate limit, which is 50/hour on a demo key
      // and the thing a co-op will actually hit. Saying so beats "failed".
      this.logger.warn(`Unsplash search returned ${response.status}`);
      throw new ServiceUnavailableException(
        response.status === 403
          ? 'Unsplash has paused searches for the moment — its hourly limit is used up. Try again later, or upload a picture instead.'
          : 'Unsplash could not answer that search.',
      );
    }

    const body = (await response.json()) as { results?: RawPhoto[] };
    return { photos: (body.results ?? []).map((photo) => this.toPhoto(photo)) };
  }

  /**
   * Tell Unsplash a photo is being used, which their terms require.
   *
   * The address comes from the client, so it is checked against Unsplash's
   * own host before anything is fetched: without that, this endpoint is an
   * open proxy that will fetch any URL a member names *with MaybeOS's key
   * attached*. A wrong-host value is a bad request, not something to follow.
   *
   * Failing to reach Unsplash does not fail the caller — the picture is
   * already chosen, and losing an analytics ping is not worth losing the
   * event somebody was creating.
   */
  async trackUse(downloadLocation: string): Promise<{ tracked: boolean }> {
    if (!this.isConfigured) return { tracked: false };

    let target: URL;
    try {
      target = new URL(downloadLocation);
    } catch {
      throw new BadRequestException('That is not a download address.');
    }

    if (target.protocol !== 'https:' || target.hostname !== 'api.unsplash.com') {
      throw new BadRequestException('That download address is not an Unsplash one.');
    }

    try {
      const response = await fetch(target, { headers: this.headers });
      return { tracked: response.ok };
    } catch (error) {
      this.logger.warn(`Unsplash download ping failed: ${(error as Error).message}`);
      return { tracked: false };
    }
  }

  /** Their shape, narrowed to ours — and the credit links carry the UTM. */
  private toPhoto(photo: RawPhoto): UnsplashPhoto {
    const profile = photo.user?.links?.html ?? 'https://unsplash.com';
    return {
      id: photo.id,
      description: photo.alt_description ?? photo.description ?? 'Unsplash photo',
      url: photo.urls?.regular ?? '',
      thumbUrl: photo.urls?.thumb ?? '',
      photographer: photo.user?.name ?? 'Unsplash',
      photographerUrl: `${profile}${profile.includes('?') ? '&' : '?'}${this.utm}`,
      downloadLocation: photo.links?.download_location ?? '',
    };
  }
}

interface RawPhoto {
  id: string;
  alt_description?: string | null;
  description?: string | null;
  urls?: { regular?: string; thumb?: string };
  links?: { download_location?: string };
  user?: { name?: string; links?: { html?: string } };
}
