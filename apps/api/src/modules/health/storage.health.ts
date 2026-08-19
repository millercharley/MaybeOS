import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Can this deployment actually reach its buckets, with a key they accept?
 *
 * Added after a stale `SUPABASE_SERVICE_ROLE_KEY` in a local `.env` was
 * rejected by Storage with `Invalid Compact JWS` — and nothing anywhere would
 * have said so. `StorageService` returns null and logs a warning when a call
 * fails, on purpose: one unreachable avatar must not fail the member it
 * belongs to, and a failed attachment must not fail the post. Both are right,
 * and together they mean a deployment whose storage key has been revoked
 * looks identical from the outside to one whose key works. Attachments would
 * simply stop appearing, avatars would silently never resolve, and the first
 * report would come from a member.
 *
 * Same shape as the email indicator and for the same reason: it separates
 * *not configured* from *configured and rejected*, which are different
 * problems with different fixes and were previously indistinguishable.
 *
 * Reported, never failed. A co-op that cannot attach a photo is still running
 * its membership, and taking the deployment out of rotation would be worse
 * than the silence this exists to break.
 *
 * No secret is exposed — a reachability verdict and an HTTP status, nothing
 * that could be replayed.
 */
@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const url = this.config.get<string>('SUPABASE_URL');
    const secret = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !secret) {
      return this.getStatus(key, true, { configured: false, reachable: false });
    }

    try {
      // Listing buckets is the cheapest call that proves the key is accepted:
      // no object is read, written or signed, and an empty project answers it
      // as readily as a full one.
      const response = await fetch(`${url}/storage/v1/bucket`, {
        headers: { apikey: secret, Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(5_000),
      });

      const buckets = response.ok ? ((await response.json()) as Array<{ id: string }>) : [];

      return this.getStatus(key, true, {
        configured: true,
        reachable: response.ok,
        httpStatus: response.status,
        // Names only. Which buckets exist is architecture, not a secret, and
        // a missing one is exactly the failure this is here to surface.
        buckets: response.ok ? buckets.map((b) => b.id).sort() : [],
      });
    } catch (err) {
      return this.getStatus(key, true, {
        configured: true,
        reachable: false,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }
}
