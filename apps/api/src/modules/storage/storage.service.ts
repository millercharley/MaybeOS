import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/** What the `org-logos` bucket itself enforces. Kept in step with it. */
export const LOGO_BUCKET = 'org-logos';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/**
 * Supabase Storage, over its REST API (D-017, OPS-03c).
 *
 * No `@supabase/supabase-js`: the two calls needed here are a POST and a
 * DELETE, and a dependency whose only job is to set two headers is not worth
 * the bundle in a Lambda that already fights the 250 MB limit.
 *
 * Both headers are required, and this is not obvious: `apikey` alone returns
 * "headers must have required property 'authorization'", and `Authorization`
 * alone returns "Invalid Compact JWS" for the modern `sb_secret_…` key format,
 * because Storage tries to parse a Bearer token as a JWT. Verified against the
 * live dev bucket on 2026-08-12.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  /** Whether uploads can work at all. False in local dev without keys. */
  get isConfigured(): boolean {
    return Boolean(this.url && this.key);
  }

  private get url(): string | undefined {
    return this.config.get<string>('SUPABASE_URL')?.replace(/\/+$/, '');
  }

  private get key(): string | undefined {
    return this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
  }

  private get headers(): Record<string, string> {
    return { apikey: this.key!, Authorization: `Bearer ${this.key!}` };
  }

  /**
   * Store an org logo and return its public URL.
   *
   * The object key is `<orgId>/<uuid>.<ext>`, so an upload never overwrites
   * the file currently in use: if this fails halfway, the org still has its
   * existing logo. It also sidesteps the CDN — the public URL is cached, so
   * reusing a key would serve a stale image after a replacement.
   */
  async uploadOrgLogo(
    orgId: string,
    body: Buffer,
    mimeType: string,
  ): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Logo uploads are not configured on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
      );
    }

    this.assertAcceptable(body, mimeType);

    const path = `${orgId}/${randomUUID()}.${EXTENSION[mimeType]}`;
    const response = await fetch(
      `${this.url}/storage/v1/object/${LOGO_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': mimeType },
        body: new Uint8Array(body),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Logo upload failed for org ${orgId}: ${response.status} ${detail.slice(0, 200)}`,
      );
      // The bucket enforces its own limits too, so a rejection here is a real
      // failure rather than something to paper over with a partial success.
      throw new ServiceUnavailableException('Could not store the logo. Try again.');
    }

    return `${this.url}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
  }

  /**
   * Remove a previously stored logo, given the public URL we handed out.
   *
   * Best-effort by design: it runs *after* the replacement is live and the
   * database points at it, so a failure here leaves an orphaned file rather
   * than an org with no logo. Never let cleanup break the operation that
   * succeeded.
   */
  async deleteOrgLogo(orgId: string, publicUrl: string | null): Promise<void> {
    if (!publicUrl || !this.isConfigured) return;

    const prefix = `${this.url}/storage/v1/object/public/${LOGO_BUCKET}/`;
    if (!publicUrl.startsWith(prefix)) return; // not ours; leave it alone

    const path = publicUrl.slice(prefix.length);
    // Only ever inside this org's own folder, so a doctored logoUrl cannot
    // make this delete another org's file.
    if (!path.startsWith(`${orgId}/`)) {
      this.logger.warn(`Refusing to delete "${path}": outside org ${orgId}`);
      return;
    }

    try {
      const response = await fetch(
        `${this.url}/storage/v1/object/${LOGO_BUCKET}/${path}`,
        { method: 'DELETE', headers: this.headers },
      );
      if (!response.ok) {
        this.logger.warn(`Could not delete old logo ${path}: ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Could not delete old logo ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Validate here as well as at the bucket. The bucket is the backstop; this
   * is what produces an error a person can act on, and it stops a 3 MB
   * payload crossing the network before being refused.
   */
  private assertAcceptable(body: Buffer, mimeType: string) {
    if (!LOGO_MIME_TYPES.includes(mimeType as LogoMimeType)) {
      throw new BadRequestException(
        `${mimeType} is not a supported image type. Use PNG, JPEG or WebP.`,
      );
    }

    if (body.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }

    if (body.length > LOGO_MAX_BYTES) {
      const mb = (body.length / 1024 / 1024).toFixed(1);
      throw new BadRequestException(`That image is ${mb} MB. The limit is 2 MB.`);
    }

    if (!this.looksLikeImage(body, mimeType)) {
      throw new BadRequestException(
        'That file does not look like the image type it claims to be.',
      );
    }
  }

  /**
   * Check the magic bytes, not just the declared type.
   *
   * The client chooses the MIME type it sends, so without this an executable
   * or an SVG full of script could be stored under `image/png` and served from
   * a public URL on the co-op's own domain.
   */
  private looksLikeImage(body: Buffer, mimeType: string): boolean {
    if (body.length < 12) return false;

    switch (mimeType) {
      case 'image/png':
        return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case 'image/jpeg':
        return body[0] === 0xff && body[1] === 0xd8 && body[body.length - 2] === 0xff && body[body.length - 1] === 0xd9;
      case 'image/webp':
        return body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP';
      default:
        return false;
    }
  }
}
