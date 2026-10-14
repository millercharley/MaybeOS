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
 * No secret is exposed: whether a token exists, and the addresses and stream
 * names, all of which are on every email the co-op sends and are public by
 * construction. The token itself is reported only as a boolean.
 *
 * The bulk fields (EML-04, EML-05) are here for the same reason as the rest.
 * Both are optional and both fail silently when wrong — naming a stream
 * Postmark does not have, or a sender it has not verified, is refused by the
 * provider and the refusal is swallowed into the log, which is shipped
 * nowhere. Without this, the only way to tell whether either took effect is
 * to send a digest and go looking for it.
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
      /*
        What bulk mail does differently (EML-04, EML-05).

        Null means "not set up", which is a real and safe state rather than a
        fault: bulk mail then goes out exactly as transactional mail does,
        which is what it did before either existed. Reported as null rather
        than omitted so the two are distinguishable from an older deploy that
        did not report them at all.
      */
      broadcastStream: this.config.get<string>('POSTMARK_BROADCAST_STREAM')?.trim() || null,
      broadcastFrom: this.config.get<string>('EMAIL_FROM_BROADCAST')?.trim() || null,
    });
  }
}
