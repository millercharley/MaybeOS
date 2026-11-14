import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../../../common/testing/source-scan';

/**
 * What the three unauthenticated reset routes answer (AUTH-09, SEC-13).
 *
 * `unauthenticated-routes.spec.ts` lists the endpoints that work without a
 * session, and its instruction for adding one is explicit: "decide whether it
 * should be public, then either add a guard or add it here *with* a test
 * pinning what it returns." These are public by definition — every caller is
 * somebody who cannot sign in — so this is that test.
 *
 * A source scan, because what is being pinned is the *shape* of each answer
 * and the absence of certain things from it, and none of that needs a server.
 * The behaviour of the rules themselves is in `password-reset.spec.ts`.
 */
const CONTROLLER = stripComments(
  readFileSync(join(__dirname, '..', 'auth.controller.ts'), 'utf8'),
);
const SERVICE = stripComments(
  readFileSync(join(__dirname, '..', 'auth.service.ts'), 'utf8'),
);

/** The body of one controller method, so a rule is read where it is kept. */
function method(name: string): string {
  const start = CONTROLLER.indexOf(`async ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const rest = CONTROLLER.slice(start);
  const end = rest.indexOf('\n  }');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('asking for a reset link', () => {
  /**
   * The token is a working credential. Returning it would make the endpoint
   * its own bypass — `sendMagicLink` carries the same warning, and the reason
   * it is worth a test rather than a comment is that "return the thing you
   * just made" is the natural way to write this method.
   */
  it('never returns the token', () => {
    const body = method('requestPasswordReset');

    expect(body).toContain('RESET_REQUESTED_MESSAGE');
    expect(body).not.toMatch(/\btoken\b/);
  });

  it('answers the same sentence however the lookup went', () => {
    const body = method('requestPasswordReset');

    // No branch, so there is no shape of response to read an answer off.
    expect(body).not.toMatch(/\bif\b/);
  });

  it('is throttled to three a minute, like a magic link', () => {
    // This endpoint causes mail to be sent to an address the caller chose.
    expect(CONTROLLER).toMatch(
      /@Throttle\(\{ short: \{ limit: 3, ttl: 60000 \} \}\)\s*\n\s*@ApiOperation\(\{ summary: 'Ask for a link to set a new password' \}\)/,
    );
  });

  it('returns nothing from the service either', () => {
    // `Promise<void>`: not a token, not a boolean about whether a user was
    // found, not the user.
    expect(SERVICE).toContain('async requestPasswordReset(email: string): Promise<void>');
  });

  it('sends nothing for an address with no account, and says nothing about it', () => {
    const start = SERVICE.indexOf('async requestPasswordReset');
    const body = SERVICE.slice(start, SERVICE.indexOf('async passwordResetIsUsable'));

    expect(body).toContain('if (!user) return;');
    // Normalised, or a capital letter matches nobody and reports nothing
    // either way (AUTH-07).
    expect(body).toContain('normalizeEmail(email)');
  });

  it('swallows a failed send rather than answering 500', () => {
    const start = SERVICE.indexOf('async requestPasswordReset');
    const body = SERVICE.slice(start, SERVICE.indexOf('async passwordResetIsUsable'));

    /*
      A thrown template would answer 500 for a real address and 200 for an
      unknown one — an enumeration oracle built out of an error path.
      `sendMagicLink` learned this one already.
    */
    expect(body).toMatch(/try \{[\s\S]*sendPasswordReset[\s\S]*\} catch/);
  });

  it('keeps the token and the link out of the log line', () => {
    const start = SERVICE.indexOf('async requestPasswordReset');
    const body = SERVICE.slice(start, SERVICE.indexOf('async passwordResetIsUsable'));
    const logged = /this\.logger\.error\(\s*`([^`]*)`/.exec(body);

    expect(logged).not.toBeNull();
    expect(logged![1]).not.toContain('token');
    expect(logged![1]).not.toContain('link');
    // The user id is fine and is what makes the line useful.
    expect(logged![1]).toContain('${user.id}');
  });
});

describe('checking whether a link is still good', () => {
  it('answers a bare boolean and nothing else', () => {
    const body = method('checkPasswordReset');

    expect(body).toContain('usable:');
    // Not the user, not the expiry, not why.
    expect(body).not.toContain('email');
    expect(body).not.toContain('expiry');
  });

  it('is throttled', () => {
    expect(CONTROLLER).toMatch(
      /@Throttle\(\{ short: \{ limit: 5, ttl: 60000 \} \}\)\s*\n\s*@ApiOperation\(\{ summary: 'Whether a password-reset link can still be used' \}\)/,
    );
  });

  it('shares one definition of usable with the redemption', () => {
    // A form that says a link is fine and a redemption that refuses it is
    // worse than either answer on its own.
    expect(SERVICE).toMatch(/async passwordResetIsUsable[\s\S]*?this\.findLiveReset\(token\)/);
    expect(SERVICE).toMatch(/async resetPassword[\s\S]*?this\.findLiveReset\(token\)/);
  });
});

describe('redeeming the link', () => {
  const body = () => {
    const start = SERVICE.indexOf('async resetPassword(');
    return SERVICE.slice(start, SERVICE.indexOf('private async findLiveReset'));
  };

  it('hands out no session', () => {
    /*
      Somebody who has just set a password should prove they know it. It also
      means a leaked link cannot become a session without the attacker
      choosing a password, which is the loudest thing they could do — the
      `password-set` notice reaches the real owner either way.
    */
    expect(method('resetPassword')).not.toContain('login');
    expect(body()).not.toContain('jwtService');
    expect(body()).toContain('return { reset: true, created: creating };');
  });

  it('gives one message for a forged, used or expired token', () => {
    // Telling them apart tells a guesser which half of the problem to work on.
    const refusals = body().match(/throw new \w+Exception\(/g) ?? [];
    expect(refusals).toHaveLength(1);
    expect(body()).toContain('has expired or has already been used');
  });

  it('is single use', () => {
    expect(body()).toContain('passwordResetToken: null');
    expect(body()).toContain('passwordResetExpiry: null');
  });

  /**
   * A reset is what somebody does when they think another person has their
   * account. Leaving a live sign-in link would leave that person a way back
   * in.
   */
  it('invalidates any outstanding magic link too', () => {
    expect(body()).toContain('magicLinkToken: null');
    expect(body()).toContain('magicLinkExpiry: null');
  });

  it('tells the address that owns the account', () => {
    expect(body()).toContain('sendPasswordSet');
  });

  it('hashes the new password rather than storing it', () => {
    expect(body()).toContain('bcrypt.hash(newPassword, 10)');
    expect(body()).not.toMatch(/passwordHash: newPassword/);
  });

  it('looks the row up by hash, and re-checks it in constant time', () => {
    const finder = SERVICE.slice(SERVICE.indexOf('private async findLiveReset'));

    expect(finder).toContain('hashResetToken(token)');
    expect(finder).toContain('passwordResetToken: hash');
    expect(finder).toContain('resetTokenMatches(token, user.passwordResetToken)');
    expect(finder).toContain('resetIsLive(user.passwordResetExpiry)');
  });

  it('is throttled', () => {
    expect(CONTROLLER).toMatch(
      /@Throttle\(\{ short: \{ limit: 5, ttl: 60000 \} \}\)\s*\n\s*@ApiOperation\(\{ summary: 'Redeem a password-reset link and set the password' \}\)/,
    );
  });
});

describe('setting a password cancels a pending reset', () => {
  /**
   * `changePassword` already cleared the magic-link token, for the stated
   * reason that another way in defeats the point. An unredeemed reset email
   * is a third way in, and the member who just set a password did not ask to
   * leave one open.
   */
  it('clears the reset token from changePassword as well', () => {
    const start = SERVICE.indexOf('async changePassword(');
    const body = SERVICE.slice(start, SERVICE.indexOf('async requestPasswordReset'));

    expect(body).toContain('passwordResetToken: null');
    expect(body).toContain('passwordResetExpiry: null');
  });
});
