import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/**
 * Encryption at rest for a secret MaybeOS has to keep usable (SEC-15).
 *
 * `Room.googleTokens` holds a Google **refresh** token, which does not expire:
 * anyone holding it can read and write that co-op's calendar until somebody
 * revokes the grant. The column was stored as plain JSON with a comment beside
 * it reading "in production, encrypt at rest", and the schema's own comment
 * described it as encrypted — **a comment that states an intention as a fact
 * is worse than no comment**, because the next reader concludes it is handled.
 *
 * Not hashing: these have to be *used*, so this is reversible by design. What
 * it buys is narrower than it sounds and worth stating plainly — a database
 * backup, a stray dump, a read-only replica or a leaked connection string no
 * longer yields working credentials on its own. It does **not** protect
 * against code execution on the API, which holds the key.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to open rather
 * than decrypting to something attacker-chosen. A fresh 12-byte IV per seal —
 * reusing one under GCM is the mistake that breaks it.
 */

/** Ciphertext as stored: JSON, so the column stays a Json column. */
export interface SealedSecret {
  /** Format version, so a future scheme can be told apart from this one. */
  v: 1;
  /**
   * Which key sealed this (SEC-16). `'d'` is the dedicated `SECRET_BOX_KEY`;
   * `'j'` — or the field being absent, which is every row sealed before this
   * existed — is the key derived from `JWT_SECRET`.
   *
   * Recorded rather than discovered by trying keys until one works. Trial
   * decryption would also "work", and it makes a wrong key indistinguishable
   * from a corrupt value; this makes the sweep able to *ask* which rows are
   * still on the old key instead of decrypting every row to find out.
   */
  k?: KeyLabel;
  iv: string;
  tag: string;
  ct: string;
}

/** `d` = dedicated `SECRET_BOX_KEY`, `j` = derived from `JWT_SECRET`. */
export type KeyLabel = 'd' | 'j';

/**
 * The label the key is derived under.
 *
 * Distinct on purpose: a key derived for sealing secrets must not be the same
 * bytes as anything signing tokens, even when both come from one secret.
 */
const HKDF_INFO = 'maybeos:secret-box:v1';

export function isSealed(value: unknown): value is SealedSecret {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SealedSecret>;
  return (
    candidate.v === 1 &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.ct === 'string' &&
    (candidate.k === undefined || candidate.k === 'd' || candidate.k === 'j')
  );
}

/**
 * Whether a stored value should be re-sealed (SEC-16).
 *
 * True for plaintext, and true for anything sealed under a key that is no
 * longer the one new seals use — which is how a co-op's tokens move onto a
 * dedicated key the moment one is configured, without anybody re-connecting a
 * calendar. **The old key has to stay readable while this is outstanding**,
 * which is why `SECRET_BOX_KEY` is added rather than swapped in for
 * `JWT_SECRET`: both are available, so nothing is unreadable in between.
 */
export function needsResealing(stored: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  if (!isSealed(stored)) return true;
  return sealedUnder(stored) !== currentKeyLabel();
}

/**
 * The key, from a dedicated variable if there is one and derived otherwise.
 *
 * `SECRET_BOX_KEY` is the right answer — a key of its own, rotatable without
 * touching sessions. It is optional because setting a new production variable
 * needs Netlify access this codebase does not have, and shipping code that
 * requires one would have broken every calendar write the moment it deployed.
 * So it falls back to HKDF over `JWT_SECRET`, which is already present
 * wherever the API runs.
 *
 * **The trade is real and worth writing down:** the fallback ties these
 * secrets to the JWT secret's fate. Rotating `JWT_SECRET` makes every stored
 * token unreadable — recoverable, since a co-op can reconnect its calendar,
 * but it is a reconnection nobody will expect. Setting `SECRET_BOX_KEY`
 * removes that coupling.
 */
function dedicatedKey(): Buffer | null {
  const configured = process.env.SECRET_BOX_KEY?.trim();
  if (!configured) return null;
  const raw = Buffer.from(configured, /^[0-9a-f]{64}$/i.test(configured) ? 'hex' : 'base64');
  if (raw.length !== 32) {
    throw new Error('SECRET_BOX_KEY must be 32 bytes, as hex or base64');
  }
  return raw;
}

function derivedKey(): Buffer {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    // Refusing rather than storing in the clear. A server with no secret
    // cannot keep one, and quietly writing plaintext is how the previous
    // arrangement lasted a month.
    throw new Error(
      'Cannot seal secrets: set SECRET_BOX_KEY, or JWT_SECRET for the derived fallback',
    );
  }
  // Salt is empty and the separation comes from `info` — standard HKDF usage
  // when there is no salt to hand, and deterministic, which is required: the
  // same key has to come back on the next cold start to open what it sealed.
  return Buffer.from(hkdfSync('sha256', Buffer.from(jwtSecret), Buffer.alloc(0), HKDF_INFO, 32));
}

/** The label new seals are written under: dedicated if there is one. */
export function currentKeyLabel(): KeyLabel {
  return dedicatedKey() ? 'd' : 'j';
}

/** Which label a stored value was sealed under. Absent means the derived one. */
export function sealedUnder(sealed: SealedSecret): KeyLabel {
  return sealed.k ?? 'j';
}

function key(label: KeyLabel): Buffer {
  if (label === 'd') {
    const dedicated = dedicatedKey();
    if (!dedicated) {
      // Naming the cause, because the recovery differs from every other
      // failure here: this value is fine and the key is missing.
      throw new Error(
        'This secret was sealed with SECRET_BOX_KEY, which is not set on this server',
      );
    }
    return dedicated;
  }
  return derivedKey();
}

/** Seal a JSON-serialisable value. */
export function seal(value: unknown): SealedSecret {
  const label = currentKeyLabel();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(label), iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]);
  return {
    v: 1,
    k: label,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/**
 * Open a sealed value. Throws if it was tampered with or sealed under another
 * key — never returns a guess.
 */
export function open<T>(sealed: SealedSecret): T {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(sealedUnder(sealed)),
    Buffer.from(sealed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8')) as T;
}

/**
 * Read a column that may hold either shape.
 *
 * Rows written before SEC-15 are plain objects and stay readable — a migration
 * that made every connected calendar stop working would be a worse outcome
 * than a week of mixed storage. The sweep in `CalendarService` closes the gap;
 * this is what keeps the product working until it has.
 */
export function unseal<T>(stored: unknown): T | null {
  if (stored === null || stored === undefined) return null;
  return isSealed(stored) ? open<T>(stored) : (stored as T);
}
