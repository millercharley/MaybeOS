/**
 * Whether an event can go out to the co-op's Instagram and Facebook (SOC-02).
 *
 * The sharing itself shipped in SOC-01 and worked. Nobody used it: in the
 * three and a half weeks after MaybeItsFate connected its Page and its
 * Instagram account, not one event was posted. The reason was placement —
 * one button, on one of the product's seven event screens, reading "Share".
 *
 * Two rules decide it, and both used to be inlined at the single call site:
 *
 * **Only public events.** A members-only event posted to Instagram would
 * invite the public to something they cannot come to, and the API refuses it
 * anyway. 753 of MaybeItsFate's 777 events are members-only, so this is the
 * case a host actually meets — and it used to hide the button with no
 * explanation, which reads as the feature not existing rather than as this
 * event not qualifying. Hence a reason rather than silence.
 *
 * **Only while it is still to come.** Posting about something that already
 * happened is not what the button is for.
 *
 * Drafts stay silent. "Publish it first" on every unpublished row is noise,
 * and a draft already says it is a draft.
 */

export const SHARE_LABEL = 'Share to Instagram & Facebook';

/** Said where a host can act on it: the visibility field is on the edit form. */
export const MEMBERS_ONLY_REASON =
  'Only public events can go out to Instagram and Facebook. Change this event’s visibility to Public to share it.';

export type Shareability =
  /** Offer the button. */
  | { state: 'ready' }
  /** Say why not — the host can usually fix it. */
  | { state: 'blocked'; reason: string }
  /** Say nothing; there is nothing useful to say. */
  | { state: 'hidden' };

export interface ShareableEvent {
  isPublished?: boolean;
  visibility?: string;
  endTime?: string | null;
  startTime?: string;
  canceledAt?: string | null;
}

export function shareability(
  event: ShareableEvent,
  sharingOn: boolean,
  now: Date = new Date(),
): Shareability {
  // The co-op has not connected anything, so none of this is a choice its
  // members can make. Nothing to explain.
  if (!sharingOn) return { state: 'hidden' };

  if (event.canceledAt) return { state: 'hidden' };
  if (!event.isPublished) return { state: 'hidden' };

  // `endTime` is optional; fall back to the start so an event with no stated
  // finish stops being shareable once it has begun.
  const over = event.endTime ?? event.startTime;
  if (over && new Date(over) <= now) return { state: 'hidden' };

  if (event.visibility !== 'PUBLIC') {
    return { state: 'blocked', reason: MEMBERS_ONLY_REASON };
  }

  return { state: 'ready' };
}

/**
 * Whether publishing this event should offer to post it (SOC-02).
 *
 * The moment somebody publishes a public event is the moment they want it
 * seen, and the product said nothing about Instagram at exactly that point.
 * Only for events that could actually go out — a members-only event must not
 * raise a dialog that would only tell the host it cannot be shared.
 */
export function shouldOfferAfterPublish(event: ShareableEvent, sharingOn: boolean): boolean {
  return shareability(event, sharingOn).state === 'ready';
}
