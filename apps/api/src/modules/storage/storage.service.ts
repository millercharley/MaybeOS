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
  'image/gif': 'gif',
};

export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/**
 * What the private `avatars` bucket itself enforces. Kept in step with it.
 *
 * Private, unlike `org-logos`. A co-op's logo is its public identity; a
 * member's face is not, and Charley's rule is that material inside MaybeOS
 * needs auth to reach. So these are served as short-lived signed URLs the
 * same way attachments are, rather than as permanent public links.
 */
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** What the private `attachments` bucket itself enforces. Kept in step with it. */
export const ATTACHMENT_BUCKET = 'attachments';
/**
 * A cover photograph is a bigger file than a logo and a smaller one than a
 * document. Below the bucket's own 25 MB so the failure is a sentence a
 * co-op can read rather than a storage rejection.
 */
export const COVER_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  // A GIF is an image, not a separate feature. A Giphy-style picker would be a
  // third-party search integration with its own key and content policy.
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const ATTACHMENT_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

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
   * A one-time URL the browser can upload straight to.
   *
   * Attachments do not travel through the API, and cannot: Netlify Functions
   * cap a request at about 6 MB, and base64 inflates a file by a third — which
   * is exactly why org logos stop at 2 MB. A phone photo or a GIF clears that
   * routinely, so the bytes go from the browser to Supabase directly and only
   * the metadata comes back here.
   *
   * The server chooses the path. That is the security of it: the caller never
   * names where its file lands, so a doctored request cannot write into
   * another co-op's folder or overwrite an existing object. The uuid also
   * means an upload never collides with one in flight.
   */
  async createAttachmentUploadUrl(
    orgId: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; path: string }> {
    this.assertConfigured('Attachments');

    const extension = ATTACHMENT_EXTENSION[mimeType];
    if (!extension) {
      throw new BadRequestException(`Files of type ${mimeType} are not accepted.`);
    }

    const path = `${orgId}/${randomUUID()}.${extension}`;
    const response = await fetch(
      `${this.url}/storage/v1/object/upload/sign/${ATTACHMENT_BUCKET}/${path}`,
      { method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' } },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Could not sign an attachment upload for org ${orgId}: ${response.status} ${detail.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException('Could not start that upload. Try again.');
    }

    const { url } = (await response.json()) as { url: string };
    return { uploadUrl: `${this.url}/storage/v1${url}`, path };
  }

  /**
   * Confirm an object is really there before a row claims it exists.
   *
   * The browser uploads on its own, so the API is told after the fact — and
   * "it worked" from a client is a claim, not a fact. Without this a failed or
   * abandoned upload leaves an attachment row pointing at nothing, which
   * renders as a broken file forever.
   */
  async attachmentExists(path: string): Promise<{ sizeBytes: number } | null> {
    if (!this.isConfigured) return null;

    const response = await fetch(
      `${this.url}/storage/v1/object/info/${ATTACHMENT_BUCKET}/${path}`,
      { headers: this.headers },
    );
    if (!response.ok) return null;

    const info = (await response.json()) as { size?: number; contentLength?: number };
    return { sizeBytes: info.size ?? info.contentLength ?? 0 };
  }

  /**
   * A short-lived URL for reading one attachment.
   *
   * The bucket is private on purpose. A public bucket with an unguessable path
   * is security by obscurity, and these files hang off members-only posts and
   * private events — a URL that escapes into a forwarded email or a browser
   * history would be permanent. Signing per read costs a round trip and keeps
   * the co-op's material inside the co-op.
   */
  async signedAttachmentUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
    if (!this.isConfigured) return null;

    const response = await fetch(
      `${this.url}/storage/v1/object/sign/${ATTACHMENT_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    );
    if (!response.ok) return null;

    const { signedURL } = (await response.json()) as { signedURL: string };
    return `${this.url}/storage/v1${signedURL}`;
  }

  /** Remove an attachment's object. Best-effort, like the logo equivalent. */
  async deleteAttachment(orgId: string, path: string): Promise<void> {
    if (!this.isConfigured) return;

    // Only ever inside this org's own folder, so a doctored path cannot make
    // this delete another co-op's file.
    if (!path.startsWith(`${orgId}/`)) {
      this.logger.warn(`Refusing to delete "${path}": outside org ${orgId}`);
      return;
    }

    try {
      await fetch(`${this.url}/storage/v1/object/${ATTACHMENT_BUCKET}/${path}`, {
        method: 'DELETE',
        headers: this.headers,
      });
    } catch (err) {
      this.logger.warn(`Attachment cleanup failed for ${path}: ${String(err)}`);
    }
  }

  /**
   * Copy an avatar MaybeOS does not own into a bucket it does.
   *
   * An imported avatar URL points at the community platform a co-op is
   * leaving. Those links are signed and tied to that account, so a roster
   * imported today shows 212 broken images the week the old subscription
   * lapses — which is not an import, it is a lease. The bytes are fetched
   * once, here, and the URL is never stored as the answer.
   *
   * Returns null rather than throwing on anything that goes wrong: one
   * unreachable avatar must not fail the member it belongs to.
   */
  async importAvatarFromUrl(userId: string, sourceUrl: string): Promise<string | null> {
    if (!this.isConfigured) return null;

    // http/https only. This fetches a URL that arrived in a spreadsheet, so
    // the scheme is the difference between downloading a picture and asking
    // the server to read its own filesystem.
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    let body: Buffer;
    let mimeType: string;
    try {
      // Capped rather than trusted: `content-length` is whatever the far end
      // says, so the real defence is reading the body and measuring it.
      const response = await fetch(parsed.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > AVATAR_MAX_BYTES) return null;

      body = buffer;
      mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    } catch (err) {
      this.logger.warn(`Avatar fetch failed for user ${userId}: ${String(err)}`);
      return null;
    }

    // Sniffed, not taken from the header. A platform serving avatars through a
    // redirect often answers `application/octet-stream`, and the bucket
    // enforces its own MIME allowlist, so trusting the header would reject
    // perfectly good images and accept whatever a hostile host declared.
    const sniffed = this.sniffImageMime(body);
    if (!sniffed) return null;
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(mimeType)) mimeType = sniffed;
    if (mimeType !== sniffed) mimeType = sniffed;

    const path = `${userId}/${randomUUID()}.${EXTENSION[mimeType] ?? 'jpg'}`;

    try {
      const upload = await fetch(`${this.url}/storage/v1/object/${AVATAR_BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': mimeType },
        body: new Uint8Array(body),
      });
      if (!upload.ok) {
        this.logger.warn(`Avatar upload failed for user ${userId}: ${await upload.text()}`);
        return null;
      }
    } catch (err) {
      this.logger.warn(`Avatar upload failed for user ${userId}: ${String(err)}`);
      return null;
    }

    return path;
  }

  /**
   * Short-lived readable URLs for many avatars at once.
   *
   * One request rather than one per member: a directory of 300 people would
   * otherwise make 300 round trips to Storage to render a single page.
   * Returns a map from path to URL, missing whatever could not be signed.
   */
  async signedAvatarUrls(
    paths: string[],
    expiresInSeconds = 3600,
  ): Promise<Map<string, string>> {
    const signed = new Map<string, string>();
    const wanted = [...new Set(paths.filter(Boolean))];
    if (!this.isConfigured || wanted.length === 0) return signed;

    try {
      const response = await fetch(`${this.url}/storage/v1/object/sign/${AVATAR_BUCKET}`, {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds, paths: wanted }),
      });
      if (!response.ok) {
        this.logger.warn(`Avatar signing failed: ${await response.text()}`);
        return signed;
      }

      const results = (await response.json()) as Array<{
        path?: string | null;
        signedURL?: string | null;
        error?: string | null;
      }>;

      for (const result of results) {
        // Supabase answers per path, so one deleted file returns an error
        // beside the rest rather than failing the batch.
        if (result.path && result.signedURL && !result.error) {
          signed.set(result.path, `${this.url}/storage/v1${result.signedURL}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Avatar signing failed: ${String(err)}`);
    }

    return signed;
  }

  /**
   * Store a Knowledge Center article's cover image, and return its path.
   *
   * **Private, and signed on read** — not public like an org logo, which is
   * what this originally was until the reference screenshots settled it. A
   * co-op's logo is its public identity. An article cover is typically a
   * photograph of that co-op's members in their own space, and a Knowledge
   * Center article is members-only, so a permanent public URL would be a
   * photo of a co-op's members reachable by anyone who ever got the link.
   * Charley's standing rule — material inside MaybeOS needs auth to reach,
   * except a public event page — covers this exactly.
   *
   * Uses the attachments bucket, which is already private, already signed on
   * read, and already accepts images. A fourth bucket would be a fourth thing
   * to configure and get the policies right on.
   *
   * A fresh key every time, so a failed replacement leaves the article with
   * the cover it had rather than a broken image.
   */
  async uploadArticleCover(orgId: string, body: Buffer, mimeType: string): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Image uploads are not configured on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
      );
    }

    // The header is a claim; the bytes are evidence. A file renamed to .png
    // must not become a stored image on the strength of its extension.
    const sniffed = this.sniffImageMime(body);
    if (!sniffed || !ATTACHMENT_MIME_TYPES.includes(sniffed as never)) {
      throw new BadRequestException('That file is not an image MaybeOS can store.');
    }
    if (body.length > COVER_MAX_BYTES) {
      throw new BadRequestException(
        `Cover images have to be under ${Math.round(COVER_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const path = `${orgId}/article-covers/${randomUUID()}.${EXTENSION[sniffed]}`;
    const response = await fetch(`${this.url}/storage/v1/object/${ATTACHMENT_BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': sniffed },
      body: new Uint8Array(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Cover upload failed for org ${orgId}: ${response.status} ${detail.slice(0, 200)}`,
      );
      throw new ServiceUnavailableException(
        response.status === 400 || response.status === 401 || response.status === 403
          ? 'File storage is not accepting uploads right now. This is a MaybeOS problem, not yours.'
          : 'Could not store the image. Try again.',
      );
    }

    return path;
  }

  /**
   * Sign many attachment paths at once.
   *
   * One request rather than one per row: an index of a dozen articles would
   * otherwise make a dozen round trips to Storage to render one screen, the
   * same problem `signedAvatarUrls` exists to avoid.
   */
  async signedAttachmentUrls(
    paths: string[],
    expiresInSeconds = 3600,
  ): Promise<Map<string, string>> {
    const signed = new Map<string, string>();
    const wanted = [...new Set(paths.filter(Boolean))];
    if (!this.isConfigured || wanted.length === 0) return signed;

    try {
      const response = await fetch(`${this.url}/storage/v1/object/sign/${ATTACHMENT_BUCKET}`, {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds, paths: wanted }),
      });
      if (!response.ok) {
        this.logger.warn(`Attachment signing failed: ${await response.text()}`);
        return signed;
      }

      const results = (await response.json()) as Array<{
        path?: string | null;
        signedURL?: string | null;
        error?: string | null;
      }>;

      for (const result of results) {
        // Per path, so one deleted file returns an error beside the rest
        // rather than failing the whole batch.
        if (result.path && result.signedURL && !result.error) {
          signed.set(result.path, `${this.url}/storage/v1${result.signedURL}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Attachment signing failed: ${String(err)}`);
    }

    return signed;
  }

  /** Magic bytes, because a content-type header is a claim, not evidence. */
  private sniffImageMime(body: Buffer): string | null {
    if (body.length < 12) return null;
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
    if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return 'image/png';
    if (body.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
    if (
      body.subarray(0, 4).toString('ascii') === 'RIFF' &&
      body.subarray(8, 12).toString('ascii') === 'WEBP'
    )
      return 'image/webp';
    return null;
  }

  private assertConfigured(what: string): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        `${what} are not configured on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).`,
      );
    }
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
      // Not "try again": a rejected key fails identically every time, and
      // telling a co-op to retry sends them round a loop that cannot end
      // (OPS-29). The status separates the two cases for whoever reads it.
      throw new ServiceUnavailableException(
        response.status === 400 || response.status === 401 || response.status === 403
          ? 'File storage is not accepting uploads right now. This is a MaybeOS problem, not yours — we have been notified.'
          : 'Could not store the logo. Try again.',
      );
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
