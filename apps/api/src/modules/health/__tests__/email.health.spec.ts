import { ConfigService } from '@nestjs/config';
import { EmailHealthIndicator } from '../email.health';

/**
 * Whether this deployment can send email is reported, not guessed.
 *
 * EmailService falls back to logging when POSTMARK_API_TOKEN is missing and
 * swallows send failures on purpose — both defensible alone, and together the
 * reason AUTH-02 went unnoticed for so long: an API that cannot send a single
 * email is indistinguishable from a healthy one from the outside.
 */
describe('EmailHealthIndicator', () => {
  const indicator = (env: Record<string, string | undefined>) =>
    new EmailHealthIndicator({
      get: (k: string) => env[k],
    } as unknown as ConfigService);

  it('says log-only when no token is configured', () => {
    const result = indicator({ EMAIL_FROM: 'noreply@maybeos.org' }).isHealthy('email');

    expect(result.email.configured).toBe(false);
    expect(result.email.transport).toBe('log-only');
  });

  it('treats an empty or whitespace token as not configured', () => {
    // Netlify env vars set to "" are the likely real-world shape of this, and
    // an empty string is truthy enough to fool a careless check.
    expect(indicator({ POSTMARK_API_TOKEN: '' }).isHealthy('email').email.configured).toBe(false);
    expect(indicator({ POSTMARK_API_TOKEN: '   ' }).isHealthy('email').email.configured).toBe(false);
  });

  it('says postmark when a token is present', () => {
    const result = indicator({
      POSTMARK_API_TOKEN: 'a-real-looking-token',
      EMAIL_FROM: 'noreply@maybeos.org',
    }).isHealthy('email');

    expect(result.email.configured).toBe(true);
    expect(result.email.transport).toBe('postmark');
    expect(result.email.from).toBe('noreply@maybeos.org');
  });

  it('never leaks the token itself', () => {
    // This is served unauthenticated to anyone who asks.
    const result = indicator({ POSTMARK_API_TOKEN: 'super-secret-value' }).isHealthy('email');

    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });

  it('stays up even when email is unconfigured', () => {
    // Failing readiness would pull a deployment that is serving every request
    // correctly out of rotation over an email setting.
    expect(indicator({}).isHealthy('email').email.status).toBe('up');
  });
});
