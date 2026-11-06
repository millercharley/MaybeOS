import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError, ApiNetworkError } from '@/lib/api';

jest.mock('@sentry/nextjs', () => ({ setUser: jest.fn(), captureException: jest.fn() }));

/**
 * A poller stops when the credential is refused (OPS-37).
 *
 * Measured on production over ninety minutes: `/unread` answered 401 fifty-four
 * times and `/happening-now` twenty-six, at exactly sixty-second intervals —
 * 16:04:22, 16:05:22, 16:06:22. Together about an eighth of all API traffic,
 * from tabs whose token had expired and which had no way to find out.
 *
 * Both pollers caught their errors with a bare `catch {}` for a good reason:
 * an error banner where a badge should be is worse than no badge. But that
 * swallowed the one error that is not a hiccup. `loadProfile` has always
 * ended the session on a 401 — it just only runs at boot, so a tab left open
 * never reached it.
 *
 * Each failed poll woke a Lambda container and took one of Supavisor's 200
 * client connections, which is the ceiling that produced 132 × 502 on
 * 2026-10-28.
 */
describe('endSessionIfRejected', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'a-token', user: null, isLoading: false });
    try {
      localStorage.setItem('maybeos_token', 'a-token');
    } catch {
      // jsdom without storage; the assertions below do not depend on it.
    }
  });

  it.each([401, 403])('ends the session when the API answers %s', (status) => {
    const ended = useAuthStore.getState().endSessionIfRejected(new ApiError(status, 'Nope'));

    expect(ended).toBe(true);
    expect(useAuthStore.getState().token).toBeNull();
  });

  /**
   * The mistake already made once in this file's history: a bare catch that
   * discarded the session on *any* failure signed people out in a way that
   * looked exactly like a normal logout, with nothing to debug.
   */
  it.each([
    ['a server error', new ApiError(500, 'Boom')],
    ['a bad request', new ApiError(400, 'No')],
    ['a rate limit', new ApiError(429, 'Slow down')],
    ['an unreachable API', new ApiNetworkError('GET', '/orgs/:org/unread')],
    ['something that is not an error at all', 'nope'],
  ])('keeps the session for %s', (_label, err) => {
    const ended = useAuthStore.getState().endSessionIfRejected(err);

    expect(ended).toBe(false);
    expect(useAuthStore.getState().token).toBe('a-token');
  });

  /** A 502 from a cold Lambda is the exact case that must not sign anybody out. */
  it('keeps the session through the outage shape it was written for', () => {
    expect(useAuthStore.getState().endSessionIfRejected(new ApiError(502, 'Bad Gateway'))).toBe(
      false,
    );
    expect(useAuthStore.getState().token).toBe('a-token');
  });
});

/**
 * The pollers route their failures through it rather than swallowing them.
 *
 * A source scan: what went wrong is a `catch {}` that discards the one error
 * that matters, and no test of what the component renders can see an error
 * being ignored.
 */
describe('the background pollers', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

  it.each([
    ['the unread badge', ['contexts', 'unread-context.tsx']],
    ['happening now', ['components', 'live', 'happening-now.tsx']],
  ])('%s ends the session instead of polling on', (_label, path) => {
    const source = read(...path);

    expect(source).toContain('endSessionIfRejected');
    // The bare form is what let it poll forever; it must not come back.
    expect(source).not.toMatch(/catch\s*\{\s*$/m);
  });
});
