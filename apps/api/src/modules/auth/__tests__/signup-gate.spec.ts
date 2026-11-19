import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../../common/testing/source-scan';
import {
  PROVE_ADDRESS_MESSAGE,
  inviteProves,
  mustProveAddress,
} from '../signup-gate';

/**
 * Registering no longer hands out a session (AUTH-10).
 *
 * On 19 November, 33 production accounts belonged to no co-op and about
 * twenty were a single mailbox, dot-aliased, arriving two or three a week
 * since 18 October. The cause was `POST /auth/register` ending with
 * `return this.authService.login(user)` while nothing anywhere read
 * `emailVerified`.
 *
 * The rule had to be built around a number that made the obvious fix
 * dangerous: **303 of 496 users are unverified and 271 of them belong to a
 * co-op.** Requiring verification outright would have locked out most of
 * MaybeItsFate.
 */
describe('who still owes us proof of their address', () => {
  const verified = { emailVerified: true, lastLoginAt: null };
  const used = { emailVerified: false, lastLoginAt: new Date('2026-09-01') };
  const fresh = { emailVerified: false, lastLoginAt: null };

  it('asks a brand-new unproved account to prove it', () => {
    expect(mustProveAddress(fresh)).toBe(true);
  });

  it('never asks a verified account, used or not', () => {
    expect(mustProveAddress(verified)).toBe(false);
    expect(mustProveAddress({ emailVerified: true, lastLoginAt: new Date() })).toBe(false);
  });

  it('grandfathers anybody who has signed in before', () => {
    /*
      The whole safety of this change. Production, before it shipped:
      unverified accounts holding a password, 53; unverified accounts that
      have signed in, 53 — the same people. So this clause means nobody
      existing is locked out, while a farmed account is refused.
    */
    expect(mustProveAddress(used)).toBe(false);
  });

  it('says what to do, and does not blame the reader (DESIGN §8)', () => {
    expect(PROVE_ADDRESS_MESSAGE).toMatch(/check your email/i);
    expect(PROVE_ADDRESS_MESSAGE).not.toMatch(/invalid|denied|failed|forbidden|error/i);
  });
});

describe('an invitation as proof of the address', () => {
  const soon = new Date(Date.now() + 86_400_000);
  const invite = { email: 'pat@example.com', expiresAt: soon, acceptedAt: null };

  it('proves the address it was sent to', () => {
    // Otherwise an invitee pays for two emails: they click the invitation,
    // land on register, and are told to go and find another message.
    expect(inviteProves(invite, 'pat@example.com')).toBe(true);
  });

  it('proves nothing for a different address', () => {
    // A forwarded invitation must not verify a stranger's address. This is
    // the one way this exemption could become a hole of its own.
    expect(inviteProves(invite, 'someone.else@example.com')).toBe(false);
  });

  it('proves nothing once expired', () => {
    const stale = { ...invite, expiresAt: new Date(Date.now() - 1000) };

    expect(inviteProves(stale, 'pat@example.com')).toBe(false);
  });

  it('proves nothing once already accepted', () => {
    expect(inviteProves({ ...invite, acceptedAt: new Date() }, 'pat@example.com')).toBe(false);
  });

  it('proves nothing when there is no invitation', () => {
    expect(inviteProves(null, 'pat@example.com')).toBe(false);
    expect(inviteProves(undefined, 'pat@example.com')).toBe(false);
  });
});

describe('the register route', () => {
  const source = stripComments(
    readFileSync(join(__dirname, '..', 'auth.controller.ts'), 'utf8'),
  );

  it('no longer signs in whoever just registered', () => {
    /*
      The defect itself, pinned. Comments are stripped because the note in
      the controller quotes the removed line to explain what happened, and
      a scan reading its own explanation would call the fix the bug.
    */
    expect(source).not.toMatch(/const user = await this\.authService\.register\([\s\S]{0,200}\n\s*return this\.authService\.login/);
  });

  it('sends the proof email instead', () => {
    expect(source).toMatch(/await this\.authService\.sendMagicLink\(user\.email\)/);
  });

  it('still signs in somebody an invitation proved', () => {
    expect(source).toMatch(/if \(proved\) return this\.authService\.login/);
  });

  it('passes the invitation through to the service', () => {
    expect(source).toMatch(/dto\.inviteToken/);
  });
});

describe('the service', () => {
  const source = stripComments(
    readFileSync(join(__dirname, '..', 'auth.service.ts'), 'utf8'),
  );

  it('checks the gate only after the password has been compared', () => {
    // Order is the security property: reversed, the message becomes an
    // account-enumeration oracle.
    const compared = source.indexOf('bcrypt.compare(password');
    const gated = source.indexOf('mustProveAddress(user)');

    expect(compared).toBeGreaterThan(-1);
    expect(gated).toBeGreaterThan(compared);
  });

  it('does not change how addresses are normalised', () => {
    /*
      Deliberately untouched. Canonicalising Gmail dots inside
      `normalizeEmail` would have been the tempting fix and a dangerous one:
      dots are ordinary in real addresses, stored rows are not canonical,
      and a lookup that no longer matches what is stored locks people out of
      their own accounts. If that defence is wanted it belongs in a separate
      key used only for the duplicate check at registration.
    */
    expect(source).toMatch(/normalizeEmail\(email\)/);
    expect(source).not.toMatch(/replace\(\s*\/\\\.\/g/);
  });
});
