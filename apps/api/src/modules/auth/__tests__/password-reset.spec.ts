import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIN_PASSWORD_LENGTH,
  RESET_REQUESTED_MESSAGE,
  RESET_WINDOW_MINUTES,
  hashResetToken,
  newResetToken,
  passwordResetUrl,
  resetExpiry,
  resetIsLive,
  resetTokenMatches,
} from '../password-reset';

/**
 * The rules a forgotten password rests on (AUTH-09).
 *
 * `sendMagicLink` carried the gap in its own comment since AUTH-02: "With no
 * password reset either, that made a forgotten password unrecoverable." Every
 * decision here is a security decision, and none of them needs a database, so
 * all of them are tested.
 */
describe('the token', () => {
  it('is long enough that guessing is not a strategy', () => {
    const { token } = newResetToken();
    // 32 random bytes, base64url: 43 characters, 256 bits.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('survives a query string without being encoded', () => {
    for (let i = 0; i < 50; i += 1) {
      const { token } = newResetToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newResetToken().token));
    expect(seen.size).toBe(200);
  });

  /**
   * The point of the whole module: what is written down is not what is
   * emailed. This is the one credential on `users` where reading a single
   * column would otherwise mean permanently changing somebody's password.
   */
  it('is stored as a hash, never as itself', () => {
    const { token, tokenHash } = newResetToken();

    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // And the hash cannot be turned back into the token by containing it.
    expect(tokenHash).not.toContain(token);
  });

  it('hashes the same token to the same thing, so a lookup can find it', () => {
    const { token, tokenHash } = newResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
  });
});

describe('matching a presented token', () => {
  it('accepts the real one', () => {
    const { token, tokenHash } = newResetToken();
    expect(resetTokenMatches(token, tokenHash)).toBe(true);
  });

  it('refuses a different one', () => {
    const { tokenHash } = newResetToken();
    expect(resetTokenMatches(newResetToken().token, tokenHash)).toBe(false);
  });

  it.each([
    ['an empty stored hash', ''],
    ['a truncated hash', 'abc123'],
    ['something that is not hex', 'not-a-hash-at-all'],
  ])('refuses rather than throwing on %s', (_label, stored) => {
    // `timingSafeEqual` throws on a length mismatch, and a thrown comparison
    // inside a verification path is how a refusal becomes a 500 that behaves
    // differently from a real one — which is itself an oracle.
    expect(() => resetTokenMatches('whatever', stored)).not.toThrow();
    expect(resetTokenMatches('whatever', stored)).toBe(false);
  });

  it('refuses an empty presented token against an empty hash', () => {
    // Two empties are not a match, or a row with no reset pending would
    // accept a caller who sent nothing.
    expect(resetTokenMatches('', '')).toBe(false);
  });
});

describe('how long a link lasts', () => {
  it('is an hour, where a sign-in link gets fifteen minutes', () => {
    expect(RESET_WINDOW_MINUTES).toBe(60);
  });

  it('expires an hour after it was made', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(resetExpiry(now).toISOString()).toBe('2026-11-14T13:00:00.000Z');
  });

  it('is live before then and not after', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    const expiry = resetExpiry(now);

    expect(resetIsLive(expiry, new Date('2026-11-14T12:59:00Z'))).toBe(true);
    expect(resetIsLive(expiry, new Date('2026-11-14T13:00:01Z'))).toBe(false);
  });

  /** A row with no reset pending must not read as a live one. */
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats %s expiry as expired', (_label, value) => {
    expect(resetIsLive(value as null)).toBe(false);
  });
});

describe('the link in the email', () => {
  it('points at the form', () => {
    expect(passwordResetUrl('https://maybeos.org', 'abc123')).toBe(
      'https://maybeos.org/reset-password/new?token=abc123',
    );
  });

  /**
   * `WEB_URL` doubles as the CORS allowlist, so it may hold several
   * comma-separated origins. The first is canonical. `magicLinkUrl` learned
   * both of these the same way.
   */
  it('takes the first of several origins', () => {
    expect(passwordResetUrl('https://maybeos.org,https://www.maybeos.org', 't')).toContain(
      'https://maybeos.org/reset-password/new',
    );
  });

  it('does not produce a double slash from a trailing one', () => {
    expect(passwordResetUrl('https://maybeos.org/', 't')).toBe(
      'https://maybeos.org/reset-password/new?token=t',
    );
  });

  it('falls back to localhost when nothing is configured', () => {
    expect(passwordResetUrl(undefined, 't')).toContain('http://localhost:3000');
  });

  it('encodes a token that would otherwise break the query string', () => {
    // Today's alphabet never needs it. The guard is for the day it changes.
    expect(passwordResetUrl('https://maybeos.org', 'a b&c')).toContain('token=a%20b%26c');
  });
});

describe('what the request endpoint says', () => {
  /**
   * One sentence for an address with an account and one without. A screen or
   * an endpoint that answered differently would be a way to ask MaybeOS who
   * its members are, and a co-op's roster is exactly what not to publish.
   */
  it('does not say whether the account exists', () => {
    expect(RESET_REQUESTED_MESSAGE).toMatch(/^If that address has an account/);

    for (const word of ['not found', 'no account', 'unknown', 'does not exist', 'sent to']) {
      expect(RESET_REQUESTED_MESSAGE.toLowerCase()).not.toContain(word);
    }
  });
});

describe('how long a password has to be', () => {
  it('is eight, and the browser agrees', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);

    // The web app keeps its own copy so three screens can read one number;
    // read here so the two cannot drift. The API is the authority — the
    // browser is the side that can be skipped.
    const web = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'web', 'lib', 'password-rules.ts'),
      'utf8',
    );
    const found = /export const MIN_PASSWORD = (\d+);/.exec(web);

    expect(found).not.toBeNull();
    expect(Number(found![1])).toBe(MIN_PASSWORD_LENGTH);
  });
});
