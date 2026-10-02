import { decodeUnsubscribe, encodeUnsubscribe } from '../unsubscribe-token';

/**
 * The token in a one-click unsubscribe link (RDR-01).
 *
 * Two failures to guard against, in opposite directions: a token that can be
 * forged lets somebody unsubscribe another member, and a token that stops
 * working leaves a member unable to make the email stop. The second is the
 * one that turns into a spam complaint.
 */

const SECRET = 'a-test-secret-at-least-32-characters-long';
const TOKEN = { userOrgId: 'membership-1', purpose: 'radar' as const };

describe('unsubscribe tokens', () => {
  it('round-trips the membership it names', () => {
    expect(decodeUnsubscribe(encodeUnsubscribe(TOKEN, SECRET), SECRET)).toEqual(TOKEN);
  });

  it('still works a decade later — an old email must still be able to stop email', () => {
    const token = encodeUnsubscribe(TOKEN, SECRET);
    const tenYears = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(tenYears);

    try {
      expect(decodeUnsubscribe(token, SECRET)).toEqual(TOKEN);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('refuses a token signed with another secret', () => {
    const token = encodeUnsubscribe(TOKEN, 'a-different-secret-also-long-enough!!');
    expect(decodeUnsubscribe(token, SECRET)).toBeNull();
  });

  it('refuses a tampered membership id', () => {
    const forged = `${Buffer.from(
      JSON.stringify({ userOrgId: 'somebody-else', purpose: 'radar' }),
    ).toString('base64url')}.${encodeUnsubscribe(TOKEN, SECRET).split('.')[1]}`;

    expect(decodeUnsubscribe(forged, SECRET)).toBeNull();
  });

  it('refuses a token for anything other than radar', () => {
    const other = encodeUnsubscribe(
      { userOrgId: 'membership-1', purpose: 'dues' as unknown as 'radar' },
      SECRET,
    );

    expect(decodeUnsubscribe(other, SECRET)).toBeNull();
  });

  it('refuses rubbish, an empty token and a missing secret', () => {
    expect(decodeUnsubscribe('not-a-token', SECRET)).toBeNull();
    expect(decodeUnsubscribe('', SECRET)).toBeNull();
    expect(decodeUnsubscribe(undefined, SECRET)).toBeNull();
    expect(decodeUnsubscribe(encodeUnsubscribe(TOKEN, SECRET), '')).toBeNull();
  });

  it('will not sign without a secret, rather than signing with an empty one', () => {
    expect(() => encodeUnsubscribe(TOKEN, '')).toThrow();
  });
});
