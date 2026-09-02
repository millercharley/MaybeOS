import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Is Google Calendar set up on this deployment?
 *
 * Written after an afternoon of establishing this by clicking a button in
 * production and reading the error. `CalendarService` refuses honestly when
 * its settings are missing, but that refusal is only reachable through an
 * authenticated admin request on a specific room — so the only way to answer
 * "is production configured yet?" was to ask someone with an admin session to
 * go and press it, once per attempt, with a deploy in between.
 *
 * The same argument as email and storage: configuration reported rather than
 * inferred. This does not prove Google will accept the credentials — only a
 * real consent round-trip does that — but it separates "not configured" from
 * "configured and rejected", and it makes the answer available without a
 * token, which is what was actually missing.
 *
 * No secret is exposed: which settings are present, and the redirect URI,
 * which Google publishes in the address bar of every consent screen.
 */
@Injectable()
export class CalendarHealthIndicator extends HealthIndicator {
  private static readonly KEYS = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ] as const;

  constructor(private readonly config: ConfigService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const missing = CalendarHealthIndicator.KEYS.filter(
      (k) => !this.config.get<string>(k)?.trim(),
    );

    return this.getStatus(key, true, {
      // 'up' regardless. A co-op that has never connected a calendar is the
      // normal case, and failing readiness over it would take a working
      // deployment out of rotation.
      configured: missing.length === 0,
      missing,
      // Echoed back so a redirect_uri_mismatch can be diagnosed by comparing
      // this against the OAuth client's registered list, which is where that
      // mismatch always turns out to be.
      redirectUri: this.config.get<string>('GOOGLE_REDIRECT_URI') || null,
    });
  }
}
