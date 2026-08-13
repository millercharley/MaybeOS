import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Can this deployment actually send email?
 *
 * Nothing answered that question anywhere. `EmailService` falls back to
 * logging when `POSTMARK_API_TOKEN` is missing, and it swallows send failures
 * on purpose so a Postmark outage cannot fail a member's registration — both
 * defensible, and together they mean a deployment that cannot send a single
 * email looks identical from the outside to one that can. That is how AUTH-02
 * survived: the magic-link endpoint answered 200 either way.
 *
 * So the configuration is reported rather than inferred. This does not prove
 * mail is being delivered — only a real send does that — but it separates
 * "not configured" from "configured and rejected", which are different
 * problems with different fixes and were previously indistinguishable.
 *
 * No secret is exposed: whether a token exists, and the From address, which
 * is on every email the co-op sends and is public by construction.
 */
@Injectable()
export class EmailHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const token = this.config.get<string>('POSTMARK_API_TOKEN');
    const configured = Boolean(token && token.trim());

    return this.getStatus(key, true, {
      // 'up' regardless: an unconfigured mailer must not fail the readiness
      // probe and take a working deployment out of rotation over it.
      transport: configured ? 'postmark' : 'log-only',
      configured,
      from: this.config.get<string>('EMAIL_FROM') ?? null,
    });
  }
}
