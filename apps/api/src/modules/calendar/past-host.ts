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

/**
 * A calendar is not a person (CAL-07).
 *
 * Google names the *calendar* as the organiser of anything created directly
 * on a shared one. MaybeItsFate's first complete import produced 777 events
 * "hosted by MaybeItsFate Main Events" — which is both wrong and worse than
 * saying nothing, because it looks like an answer.
 *
 * A calendar's own address is either the calendar id being read or one of
 * Google's generated group addresses; neither belongs to anybody.
 */
export function isCalendarItself(email: string | null, calendarId: string | null): boolean {
  const key = hostKey(email);
  if (!key) return false;

  if (calendarId && key === calendarId.trim().toLowerCase()) return true;

  return key.endsWith('@group.calendar.google.com') || key.endsWith('@group.v.calendar.google.com');
}

/**
 * The person behind an entry, if there is one.
 *
 * The organiser first, because that is who an invitation says is running it.
 * The creator when the organiser turns out to be the calendar — on a shared
 * calendar that is the common case, and the creator is the member who typed
 * it in. Null when both are the calendar, which is honest: a co-op's own
 * calendar entry often has no host, and "hosted by the calendar" is not a
 * better answer than none.
 */
export function personFor(
  entry: {
    organiserEmail: string | null;
    organiserName: string | null;
    creatorEmail: string | null;
    creatorName: string | null;
  },
  calendarId: string | null,
): { email: string | null; name: string | null } {
  if (entry.organiserEmail && !isCalendarItself(entry.organiserEmail, calendarId)) {
    return { email: entry.organiserEmail, name: entry.organiserName };
  }

  if (entry.creatorEmail && !isCalendarItself(entry.creatorEmail, calendarId)) {
    return { email: entry.creatorEmail, name: entry.creatorName };
  }

  return { email: null, name: null };
}

/**
 * A member's name, as a key for matching a calendar entry's title (SPC-34).
 *
 * MaybeItsFate's room calendars carry entries typed by hand, where the only
 * record of whose reservation it is, is the title: "Brooke Sullivan Brown".
 * No guest line, and the creator is whoever was at the keyboard — so these
 * imported as that person's, and were marked the co-op's because the creator
 * was the organiser they would have fallen back to anyway.
 */
export function nameKey(name: string | null | undefined): string | null {
  const value = (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return value === '' ? null : value;
}

/**
 * Names that belong to exactly one member.
 *
 * A name two people share identifies neither, and a reservation handed to
 * the wrong one of them is worse than a reservation handed to nobody — so
 * duplicates are dropped rather than guessed between.
 */
export function unambiguousNames(
  members: { userId: string; name: string | null }[],
): Map<string, string> {
  const seen = new Map<string, string | null>();

  for (const member of members) {
    const key = nameKey(member.name);
    if (!key) continue;
    // null marks a key already claimed by somebody else.
    seen.set(key, seen.has(key) && seen.get(key) !== member.userId ? null : member.userId);
  }

  const unique = new Map<string, string>();
  for (const [key, userId] of seen) if (userId) unique.set(key, userId);
  return unique;
}
