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

  /**
   * What bulk mail does differently (EML-04, EML-05).
   *
   * Both settings fail silently when wrong — a stream Postmark does not have,
   * or a sender it has not verified, is refused and the refusal is swallowed
   * into a log that is shipped nowhere. Reporting them is the only way to
   * tell from outside that they took effect.
   */
  describe('the bulk mail settings', () => {
    it('reports the stream and the sender when both are set', () => {
      const result = indicator({
        POSTMARK_API_TOKEN: 'token',
        EMAIL_FROM: 'noreply@maybeos.org',
        POSTMARK_BROADCAST_STREAM: 'broadcast',
        EMAIL_FROM_BROADCAST: 'news@maybeos.org',
      }).isHealthy('email');

      expect(result.email.broadcastStream).toBe('broadcast');
      expect(result.email.broadcastFrom).toBe('news@maybeos.org');
    });

    it('reports null rather than omitting them when unset', () => {
      // Null is "not set up", which is a safe state. Omitting the keys would
      // be indistinguishable from an older deploy that cannot report them.
      const result = indicator({ POSTMARK_API_TOKEN: 'token' }).isHealthy('email');

      expect(result.email).toHaveProperty('broadcastStream', null);
      expect(result.email).toHaveProperty('broadcastFrom', null);
    });

    it.each(['', '   '])('treats %p as unset', (value) => {
      const result = indicator({
        POSTMARK_API_TOKEN: 'token',
        POSTMARK_BROADCAST_STREAM: value,
        EMAIL_FROM_BROADCAST: value,
      }).isHealthy('email');

      expect(result.email.broadcastStream).toBeNull();
      expect(result.email.broadcastFrom).toBeNull();
    });

    it('still reports them when email is otherwise unconfigured', () => {
      // A misconfigured deploy is exactly when somebody is reading this.
      const result = indicator({ POSTMARK_BROADCAST_STREAM: 'broadcast' }).isHealthy('email');

      expect(result.email.configured).toBe(false);
      expect(result.email.broadcastStream).toBe('broadcast');
    });
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
