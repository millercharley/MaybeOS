import { encodeState, decodeState, STATE_TTL_MS } from '../connect-oauth';

/**
 * The `state` parameter for Stripe Connect OAuth (PAY-05).
 *
 * Stripe's callback is a browser redirect with no Authorization header, so the
 * API cannot tell who is returning — `state` is the only thing that carries it.
 * That makes this the security of the whole flow, and the two failures it
 * prevents both end with somebody else's money:
 *
 *   - forge a state naming another co-op, complete OAuth with your own Stripe
 *     account, and that co-op's ticket sales pay you;
 *   - link a victim's Stripe account to an org you control, and refund it out.
 *
 * So a state that is tampered with, expired, or signed with the wrong secret
 * must be refused rather than partially trusted.
 */
describe('Connect OAuth state', () => {
  const SECRET = 'server-signing-secret';
  const state = { orgId: 'org-1', userId: 'admin-1', issuedAt: Date.now() };

  it('round-trips an honest state', () => {
    const decoded = decodeState(encodeState(state, SECRET), SECRET);

    expect(decoded).toEqual(state);
  });

  it('refuses a state signed with a different secret', () => {
    // The whole point: only this server can mint one.
    const forged = encodeState(state, 'an-attackers-secret');

    expect(decodeState(forged, SECRET)).toBeNull();
  });

  it('refuses a tampered org id', () => {
    // The attack that matters — repointing a completed OAuth at another co-op.
    const encoded = encodeState(state, SECRET);
    const [, signature] = encoded.split('.');
    const swapped = Buffer.from(
      JSON.stringify({ ...state, orgId: 'someone-elses-org' }),
    ).toString('base64url');

    expect(decodeState(`${swapped}.${signature}`, SECRET)).toBeNull();
  });

  it('refuses a state that has expired', () => {
    const encoded = encodeState(state, SECRET);
    const later = state.issuedAt + STATE_TTL_MS + 1000;

    expect(decodeState(encoded, SECRET, later)).toBeNull();
  });

  it('accepts one still inside its window', () => {
    const encoded = encodeState(state, SECRET);

    expect(decodeState(encoded, SECRET, state.issuedAt + STATE_TTL_MS - 1000)).not.toBeNull();
  });

  it('refuses a state dated in the future', () => {
    // An honest flow cannot produce one; a clock-skewed or hand-made state can.
    const ahead = encodeState({ ...state, issuedAt: state.issuedAt + 60_000 }, SECRET);

    expect(decodeState(ahead, SECRET, state.issuedAt)).toBeNull();
  });

  it('refuses malformed input rather than throwing', () => {
    // These arrive from a query string, so they can be anything at all.
    for (const bad of ['', 'nonsense', 'a.b.c', '.', 'only-payload.', undefined]) {
      expect(decodeState(bad as string | undefined, SECRET)).toBeNull();
    }
  });

  it('refuses a payload missing the fields it must carry', () => {
    const payload = Buffer.from(JSON.stringify({ orgId: 'org-1' })).toString('base64url');
    const encoded = `${payload}.${encodeState({ ...state }, SECRET).split('.')[1]}`;

    expect(decodeState(encoded, SECRET)).toBeNull();
  });

  it('will not sign without a secret, rather than signing with an empty one', () => {
    // An empty secret produces a valid-looking HMAC anybody could reproduce.
    expect(() => encodeState(state, '')).toThrow();
    expect(decodeState(encodeState(state, SECRET), '')).toBeNull();
  });
});
