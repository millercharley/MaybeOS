import { api } from '@/lib/api';

/**
 * What the unsubscribe page is showing, and why (RDR-01).
 *
 * The page itself is two paragraphs around a button. The part worth testing
 * is the decision underneath it, and this app's harness renders no components
 * — every spec in `__tests__` exercises a function or scans a file. A state
 * machine written inside the component would be a state machine nothing can
 * call, which is exactly how `safePath()` reached production with a bug only
 * a live Sentry trace found (OPS-10).
 */
export type UnsubscribeState =
  /** A token in hand, waiting for the member to actually ask. */
  | { kind: 'asking' }
  | { kind: 'stopping' }
  /** Done. `orgName` is absent only if the API chose not to name the co-op. */
  | { kind: 'stopped'; orgName?: string }
  /** No token on the address, or one the API would not accept. */
  | { kind: 'badLink' }
  /** The request got no answer at all. Nothing changed, so offer the button again. */
  | { kind: 'failed' };

/**
 * Where the page starts.
 *
 * A link copied out of an email by hand loses its query string often enough
 * to deserve its own state: there is nothing to press, so the page says so on
 * arrival rather than after a round trip that was never going to succeed.
 */
export function initialUnsubscribeState(
  token: string | null | undefined,
): UnsubscribeState {
  return token ? { kind: 'asking' } : { kind: 'badLink' };
}

/**
 * Stop the digests, and say what happened.
 *
 * The API answers `{ ok: false }` with a 200 both for a forged token and for
 * a membership that no longer exists — one answer on purpose, so somebody
 * holding a guessed token learns nothing from the reply. To the member those
 * read the same way: the link did not work.
 *
 * A thrown error is a different fact. The API is down, or the connection
 * dropped, and the member is still subscribed — so that one must not be
 * flattened into "the link did not work", which would tell somebody their
 * emails had stopped when they had not.
 */
export async function stopRadarEmails(
  token: string | null | undefined,
): Promise<UnsubscribeState> {
  if (!token) return { kind: 'badLink' };

  try {
    const result = await api.radar.unsubscribe(token);
    return result.ok ? { kind: 'stopped', orgName: result.orgName } : { kind: 'badLink' };
  } catch {
    return { kind: 'failed' };
  }
}
