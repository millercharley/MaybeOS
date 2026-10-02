import { api } from '@/lib/api';

/**
 * What the unsubscribe page is showing, and why (RDR-01, RCP-01).
 *
 * The page itself is two paragraphs around a button. The part worth testing
 * is the decision underneath it, and this app's harness renders no components
 * — every spec in `__tests__` exercises a function or scans a file. A state
 * machine written inside the component would be a state machine nothing can
 * call, which is exactly how `safePath()` reached production with a bug only
 * a live Sentry trace found (OPS-10).
 *
 * One route now stops two different emails: the weekly Radar digest and the
 * monthly recap. Which one a token is for is inside the token, so the *copy*
 * is part of the decision rather than part of the markup — telling somebody
 * who stopped the monthly recap that their weekly digest has stopped is a
 * false statement about their own mailbox, and the next thing they press is
 * the junk button.
 */

/** Which email the token was for. The API decodes it; the page never guesses. */
export type UnsubscribePurpose = 'radar' | 'recap';

export type UnsubscribeState =
  /** A token in hand, waiting for the member to actually ask. */
  | { kind: 'asking' }
  | { kind: 'stopping' }
  /**
   * Done. `orgName` is absent only if the API chose not to name the co-op,
   * and `purpose` only if it did not say which email this was — an older API
   * than this page, which the copy handles by naming neither.
   */
  | { kind: 'stopped'; orgName?: string; purpose?: UnsubscribePurpose }
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
 * The reply as it arrives on the wire.
 *
 * `purpose` is not on `api.radar.unsubscribe`'s return type yet and
 * `lib/api.ts` is not this change's to edit, so it is read through a type
 * that admits it — and validated below, because it comes off the network.
 */
interface UnsubscribeReply {
  ok: boolean;
  orgName?: string;
  purpose?: string;
}

/**
 * Stop the emails, and say what happened.
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
export async function stopEmails(
  token: string | null | undefined,
): Promise<UnsubscribeState> {
  if (!token) return { kind: 'badLink' };

  try {
    const result: UnsubscribeReply = await api.radar.unsubscribe(token);
    if (!result.ok) return { kind: 'badLink' };
    return { kind: 'stopped', orgName: result.orgName, purpose: purposeOf(result.purpose) };
  } catch {
    return { kind: 'failed' };
  }
}

/** Anything the page does not recognize is left undefined rather than assumed. */
function purposeOf(value: unknown): UnsubscribePurpose | undefined {
  return value === 'radar' || value === 'recap' ? value : undefined;
}

export interface UnsubscribeCopy {
  title: string;
  body: string;
}

/** What each email is called, in the sentence that says it has stopped. */
const EMAIL_NAMES: Record<UnsubscribePurpose, string> = {
  radar: 'the weekly Radar digest',
  recap: 'the monthly recap',
};

/**
 * The words on the page, for whichever state it is in.
 *
 * Before the button is pressed nothing here knows which email the link came
 * from — the token is not decoded until the POST — so the asking and bad-link
 * wording names both or neither. It names both: a member reading it has one of
 * the two emails open in front of them, and "these emails" alone would leave
 * them wondering whether this is the thing that stops everything.
 */
export function unsubscribeCopy(state: UnsubscribeState): UnsubscribeCopy {
  const coop = (name?: string) => name ?? 'Your co-op';

  switch (state.kind) {
    case 'stopped':
      return {
        title: 'Those emails have stopped',
        body:
          `${coop(state.orgName)} won’t send you ` +
          `${state.purpose ? EMAIL_NAMES[state.purpose] : 'that email'} again. ` +
          'Everything else they send — event announcements, messages, anything from an ' +
          'organizer — is unchanged.',
      };

    case 'badLink':
      return {
        title: 'That link didn’t work',
        body:
          'It may have been cut short by your mail app, or it may have been used already. ' +
          'Nothing has changed either way, so those emails are still coming. You can switch ' +
          'them off yourself from your profile — the weekly Radar digest and the monthly ' +
          'recap each have their own setting there.',
      };

    case 'failed':
      return {
        title: 'That didn’t go through',
        body:
          'We couldn’t reach MaybeOS, so nothing has changed and the emails haven’t ' +
          'stopped yet. Try again in a moment.',
      };

    default:
      return {
        title: 'Stop these emails?',
        body:
          'This stops the one email you followed the link from — the weekly Radar digest, ' +
          'or the monthly recap — and nothing else. Everything else your co-op sends you ' +
          'stays exactly as it is.',
      };
  }
}
