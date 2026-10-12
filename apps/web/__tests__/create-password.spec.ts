import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Creating a first password (AUTH-04).
 *
 * Charley: "make sure that for users who entered their organization via the
 * Magic Link, that they have the option to create a password on their
 * account once they are inside their organization… they don't have a current
 * password to authorize their need to update their password."
 *
 * The form asked everybody for their current password. At MaybeItsFate 433
 * of 439 members have none — everybody who came in through a sign-in link —
 * so the one screen for setting a password refused almost the whole co-op.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const src = strip(
  readFileSync(join(__dirname, '..', 'components', 'member', 'change-password.tsx'), 'utf8'),
);

describe('the password form', () => {
  it('asks the account which question to put', () => {
    expect(src).toMatch(/api\.auth[\s\S]{0,40}\.profile\(token\)/);
    expect(src).toMatch(/setHasPassword/);
  });

  it('assumes there is one when it cannot tell', () => {
    /*
      The safe direction. Asking for a password that exists is a nuisance;
      not asking for one that does is a hole, and a profile request can
      fail. Both the missing-field and the failed-request paths default the
      same way.
    */
    expect(src).toMatch(/me\.hasPassword \?\? true/);
    expect(src).toMatch(/catch\(\(\) => setHasPassword\(true\)\)/);
  });

  it('hides the current-password field when there is nothing to put in it', () => {
    expect(src).toMatch(/\{hasPassword !== false && \(/);
  });

  it('does not require a current password to create one', () => {
    // The button was `disabled={busy || !current || !next}`, so for a
    // link-only member it could never be pressed at all.
    const at = src.indexOf('type="submit"');
    expect(src.slice(at, at + 200)).toMatch(/hasPassword !== false && !current/);
  });

  it('does not send a current password it never asked for', () => {
    expect(src).toMatch(/hasPassword \? \{ currentPassword: current \} : \{\}/);
  });

  it('calls it creating, not changing', () => {
    // "Change password" on a screen for somebody who has none reads as a
    // screen that is not for them.
    expect(src).toMatch(/Create a password/);
    expect(src).toMatch(/Create password/);
    expect(src).toMatch(/Password created/);
  });

  it('says a password is an addition, not a replacement for the link', () => {
    // Nobody should think setting one takes the sign-in link away.
    expect(src).toMatch(/you can use either/);
    expect(src).toMatch(/keep using a sign-in link/);
  });
});

describe('what the profile tells the browser', () => {
  const api = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');

  it('carries whether a password exists, and never the password', () => {
    expect(api).toMatch(/hasPassword\?: boolean;/);
    expect(api).not.toMatch(/passwordHash/);
  });

  it('makes the current password optional on the way out', () => {
    expect(api).toMatch(/currentPassword\?: string; newPassword: string/);
  });
});
