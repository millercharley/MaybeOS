import { api } from '@/lib/api';

/**
 * Saying you are coming without an account (EVT-49).
 *
 * Charley: "Make sure non-members can RSVP."
 *
 * The API has served `POST /orgs/:orgId/events/:eventId/rsvp/guest` since
 * PUB-05 and the public events list has always used it — but the *event
 * page*, which is where every link to an event goes, told a stranger to sign
 * in. So the one page somebody lands on from a co-op's website, a shared
 * link or the embed was the one place they could not say they were coming.
 *
 * The decision lives here rather than in either page for the reason
 * `radar-unsubscribe.ts` gives: this app's harness renders no components, so
 * logic written inside one is logic nothing can call. Two pages now offer
 * this, and two copies of "what counts as a usable name and address" is one
 * copy that goes stale.
 */

export type GuestRsvpState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** The API decides: a full event with a waitlist says so rather than refusing. */
  | { kind: 'done'; status: 'CONFIRMED' | 'WAITLISTED' }
  | { kind: 'failed'; message: string };

/**
 * What a host needs to know who turned up.
 *
 * Both required. A name with no address cannot be told the event moved, and
 * an address with no name is a row on a door list nobody can read out.
 */
export function guestRsvpReady(name: string, email: string): boolean {
  return name.trim().length > 0 && email.trim().length > 0;
}

export const NEED_BOTH = 'We need a name and an email so the host knows who is coming.';

/**
 * Trimmed on the way out, deliberately.
 *
 * A name pasted from a phone keyboard arrives with a trailing space, and an
 * address with one does not match the address the same person's ticket was
 * bought under — which is how one person becomes two rows on a door list.
 */
export async function submitGuestRsvp(input: {
  orgId: string;
  eventId: string;
  name: string;
  email: string;
}): Promise<GuestRsvpState> {
  if (!guestRsvpReady(input.name, input.email)) {
    return { kind: 'failed', message: NEED_BOTH };
  }

  try {
    const result = await api.events.guestRsvp(input.orgId, input.eventId, {
      name: input.name.trim(),
      email: input.email.trim(),
    });

    /*
      Defaulting to CONFIRMED only when the API said nothing. Telling somebody
      they have a place when they are on a waitlist is the one outcome worth
      avoiding here — they stop looking for another way in and turn up to a
      full room.
    */
    const status = result?.status === 'WAITLISTED' ? 'WAITLISTED' : 'CONFIRMED';
    return { kind: 'done', status };
  } catch (err) {
    return {
      kind: 'failed',
      message: err instanceof Error ? err.message : 'That did not go through.',
    };
  }
}

/** What the page says once it is done. */
export function guestRsvpConfirmation(status: 'CONFIRMED' | 'WAITLISTED'): string {
  return status === 'WAITLISTED'
    ? "You're on the waitlist — we'll email you if a place opens up."
    : "You're coming — see you there.";
}
