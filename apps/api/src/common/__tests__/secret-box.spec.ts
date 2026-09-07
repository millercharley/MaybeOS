import { isSealed, open, seal, unseal } from '../secret-box';

/**
 * Encryption at rest for a secret that has to stay usable (SEC-15).
 *
 * `Room.googleTokens` holds a Google refresh token, which does not expire, and
 * was stored as plain JSON under a comment promising to encrypt it — with the
 * schema describing it as already encrypted.
 */
describe('sealing a secret', () => {
  const KEY = 'a'.repeat(43) + '=';
  const TOKENS = { access_token: 'ya29.abc', refresh_token: '1//zzz', expiry_date: 1_800_000 };

  beforeEach(() => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 7).toString('base64');
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    delete process.env.SECRET_BOX_KEY;
    delete process.env.JWT_SECRET;
  });

  it('round-trips the value', () => {
    expect(open(seal(TOKENS))).toEqual(TOKENS);
  });

  it('leaves nothing readable in the stored shape', () => {
    const sealed = seal(TOKENS);

    const asJson = JSON.stringify(sealed);
    expect(asJson).not.toContain('ya29.abc');
    expect(asJson).not.toContain('1//zzz');
    expect(asJson).not.toContain('refresh_token');
  });

  it('never produces the same ciphertext twice', () => {
    // A fixed IV under GCM is the mistake that breaks it, and identical
    // ciphertexts are how you would notice.
    const a = seal(TOKENS);
    const b = seal(TOKENS);
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it('refuses a tampered ciphertext rather than returning something', () => {
    const sealed = seal(TOKENS);
    const flipped = Buffer.from(sealed.ct, 'base64');
    flipped[0] ^= 0xff;

    expect(() => open({ ...sealed, ct: flipped.toString('base64') })).toThrow();
  });

  it('refuses a value sealed under another key', () => {
    const sealed = seal(TOKENS);
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 9).toString('base64');

    expect(() => open(sealed)).toThrow();
  });

  it('refuses to seal with no key at all', () => {
    // Storing in the clear because the environment is misconfigured is how
    // the previous arrangement lasted a month.
    delete process.env.SECRET_BOX_KEY;
    expect(() => seal(TOKENS)).toThrow(/SECRET_BOX_KEY/);
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(16, 7).toString('base64');
    expect(() => seal(TOKENS)).toThrow(/32 bytes/);
  });

  it('accepts a key as hex as well as base64', () => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 3).toString('hex');
    expect(open(seal(TOKENS))).toEqual(TOKENS);
    expect(KEY).toHaveLength(44); // the base64 length a 32-byte key produces
  });
});

describe('the derived fallback', () => {
  const TOKENS = { refresh_token: '1//zzz' };

  beforeEach(() => {
    delete process.env.SECRET_BOX_KEY;
    process.env.JWT_SECRET = 'the-jwt-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('works without a dedicated key, so the deploy needs no new variable', () => {
    expect(open(seal(TOKENS))).toEqual(TOKENS);
  });

  it('is deterministic across restarts', () => {
    // The same key has to come back on the next cold start, or everything
    // sealed by the previous one is lost.
    const sealed = seal(TOKENS);
    process.env.JWT_SECRET = 'the-jwt-secret';
    expect(open(sealed)).toEqual(TOKENS);
  });

  it('is not the JWT secret itself', () => {
    // Derived under its own label: a key for sealing secrets must not be the
    // same bytes as the one signing sessions.
    expect(JSON.stringify(seal(TOKENS))).not.toContain('the-jwt-secret');
  });

  it('stops working if the JWT secret is rotated — the trade, stated', () => {
    const sealed = seal(TOKENS);
    process.env.JWT_SECRET = 'a-new-jwt-secret';

    expect(() => open(sealed)).toThrow();
  });
});

describe('reading a column that may hold either shape', () => {
  beforeEach(() => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 7).toString('base64');
  });
  afterEach(() => {
    delete process.env.SECRET_BOX_KEY;
  });

  it('opens a sealed value', () => {
    expect(unseal(seal({ a: 1 }))).toEqual({ a: 1 });
  });

  it('passes through a row written before sealing existed', () => {
    // Eight production rooms are in this state until the boot sweep runs. A
    // change that made every connected calendar stop working would be worse
    // than a few days of mixed storage.
    expect(unseal({ access_token: 'legacy' })).toEqual({ access_token: 'legacy' });
  });

  it('treats an empty column as nothing', () => {
    expect(unseal(null)).toBeNull();
    expect(unseal(undefined)).toBeNull();
  });

  it('knows one shape from the other', () => {
    expect(isSealed(seal({ a: 1 }))).toBe(true);
    expect(isSealed({ access_token: 'x' })).toBe(false);
    expect(isSealed({ v: 2, iv: 'x', tag: 'y', ct: 'z' })).toBe(false);
    expect(isSealed(null)).toBe(false);
  });
});
