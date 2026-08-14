import { scrubEvent, sharedOptions } from '@/sentry.shared';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

/**
 * No IP address leaves the application.
 *
 * This is a promise the privacy statement makes in plain words, so it is worth
 * a test rather than a default. It was not true until 2026-08-14: an error
 * report identified an anonymous visitor as `ip:75.60.164.23` and Sentry
 * resolved it to a city.
 *
 * Two separate things have to hold, which is the part worth pinning. The SDK
 * must not attach an IP (`sendDefaultPii: false`), *and* Sentry must not infer
 * one from the connection — which it does whenever `user.ip_address` is missing
 * or set to the sentinel `"{{auto}}"`. Turning off the first alone leaves the
 * second, and the report still carries an IP.
 */
describe('Sentry never receives an IP address', () => {
  const scrub = (event: Partial<ErrorEvent>) =>
    scrubEvent(event as ErrorEvent, {} as EventHint);

  it('sets ip_address to null on an event that had none', () => {
    // Absent is not safe: absent is exactly when Sentry fills it in itself.
    const out = scrub({});

    expect(out?.user).toBeDefined();
    expect(out?.user?.ip_address).toBeNull();
  });

  it('overwrites an IP the SDK attached', () => {
    const out = scrub({ user: { id: 'user-1', ip_address: '75.60.164.23' } });

    expect(out?.user?.ip_address).toBeNull();
  });

  it('overwrites the "{{auto}}" sentinel, which is what asks Sentry to infer one', () => {
    const out = scrub({ user: { ip_address: '{{auto}}' } });

    expect(out?.user?.ip_address).toBeNull();
  });

  it('keeps the account id, which is how a report is still traceable', () => {
    // The point is not anonymity from ourselves — it is that a third party
    // never receives a network identifier or anything personal.
    const out = scrub({ user: { id: 'user-1', ip_address: '203.0.113.9' } });

    expect(out?.user?.id).toBe('user-1');
    expect(out?.user?.ip_address).toBeNull();
  });

  it('never sends names, emails or cookies inferred from the request', () => {
    // The SDK default, asserted because the privacy statement depends on it
    // and a silently changed default would break a published promise.
    expect(sharedOptions.sendDefaultPii).toBe(false);
  });

  it('still strips credentials from headers', () => {
    // The existing guarantee must survive the new one.
    const out = scrub({
      request: { headers: { Authorization: 'Bearer secret', cookie: 'a=b' } },
    });

    expect(out?.request?.headers?.['Authorization']).toBeUndefined();
    expect(out?.request?.headers?.['cookie']).toBeUndefined();
  });
});
