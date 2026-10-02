/**
 * Who ran an imported event, when they are not a member (CAL-03).
 *
 * A co-op importing years of its own calendar brings events hosted by people
 * who have since left. The importer matched the Google organiser to a
 * membership and, finding none, recorded nothing — so a decade of a
 * community's evenings arrived with nobody's name on them. Room reservations
 * were worse: `bookings.userId` is required, so every unmatched reservation
 * was filed under the co-op's first organiser, producing a booking history
 * saying one person held every room for years.
 *
 * Charley, 2026-10-02: "If a member is missing because they left the co-op,
 * just note the name of this user in the past event. If the person re-joins
 * in the future, reconnect them to their past events."
 *
 * So the organiser travels with the row. The name is what the event shows;
 * the address is only ever matched, never displayed — it belongs to somebody
 * who is not here to consent to it being published.
 */

/** Lowercased and trimmed, because matching an address is all this is for. */
export function hostKey(email: string | null | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  return value === '' ? null : value;
}

/** A display name for a host MaybeOS has no account for. */
export function hostLabel(name: string | null | undefined, email: string | null | undefined): string | null {
  const clean = (name ?? '').trim();
  if (clean) return clean;

  // Falling back to the local part rather than the whole address: an event
  // page is read by the whole co-op, and "sam" tells them who ran it without
  // publishing where to reach somebody who has left.
  const key = hostKey(email);
  if (!key) return null;

  const local = key.split('@')[0].replace(/[._+-]+/g, ' ').trim();
  return local === '' ? null : local;
}

/**
 * What to write for an event's host.
 *
 * The matched member wins and the stored name is cleared with it — once
 * somebody is a member, their own name is the one the product should use, and
 * a stale copy from a calendar invite three years ago would outlive every
 * rename they ever make.
 */
export function hostFields(
  hostId: string | null,
  organiserEmail: string | null,
  organiserName: string | null,
): { hostId: string | null; hostEmail: string | null; hostName: string | null } {
  if (hostId) {
    return { hostId, hostEmail: null, hostName: null };
  }

  return {
    hostId: null,
    hostEmail: hostKey(organiserEmail),
    hostName: hostLabel(organiserName, organiserEmail),
  };
}
