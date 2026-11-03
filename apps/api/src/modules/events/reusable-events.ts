/**
 * Starting a new event from one somebody already ran (EVT-48).
 *
 * Charley: "When a user creates a new event, provide an option to reuse a
 * previous event to pre-fill the event information (everything except the date
 * and the room)… When there are events with the exact same title, consider
 * this the same event and simply provide the most recent event as the option
 * to select (instead of showing a list of the same title that could be 40
 * events long)."
 *
 * **Not `clone` (EVT-38).** That copies an event to a new date on the server
 * and holds its rooms. This fills in a form the member then edits, and nothing
 * exists until they submit — which is the difference between "do that again on
 * the 14th" and "I am writing a new event and most of the answers are the same
 * as last time".
 *
 * **One row per title.** Board Games Club is 46 events in MaybeItsFate and
 * Ecstatic Dance ~ 1st Sundays is 37; a picker that listed each date would be
 * 767 rows of the same dozen evenings. The title is the grouping for the same
 * reason it is in `host-transfer.ts`: `parentEventId` only exists for series
 * MaybeOS itself repeated, and most of an import has no recurrence id.
 *
 * **Exact titles only, deliberately.** "Figure drawing" and "Figure Drawing
 * with Chris Manzo" are two things a co-op runs, not one thing spelled two
 * ways, and collapsing them would hide the one somebody is looking for behind
 * the one they are not. Case and surrounding space are not spelling, so those
 * are ignored; nothing else is.
 */

export interface ReusableCandidate {
  id: string;
  title: string;
  startTime: Date;
  /** When it was last written to, which is what "most recent" turns on. */
  updatedAt: Date;
}

/** `"  Board Games Club "` and `"board games club"` are the same event. */
const key = (title: string) => title.trim().toLowerCase();

/**
 * The most recent event of each title, newest first.
 *
 * **"Most recent" is the one last written to, not the one with the latest
 * date.** This was `startTime`, and it quietly broke the job this feature
 * exists for.
 *
 * Charley: "All migrated events will need editing. I can imagine the member
 * editing one event, then using the clone option to pre-fill the fields,
 * image, etc. for each additional cloned event."
 *
 * Forty-six Board Games Clubs arrive from a calendar import with the same
 * title and the same empty description, running to 2028. The member writes a
 * real description on the one in November, saves, opens the next one — and by
 * `startTime` the single option they are offered is the 2028 instance, which
 * still carries the unedited import. They would copy the junk they are trying
 * to replace, forty-five times.
 *
 * By `updatedAt`, the option is whichever one they last worked on, so the
 * good version spreads. Before anybody has edited anything the instances are
 * identical and the choice does not matter; the moment one of them is better,
 * it is the one offered.
 *
 * The input is expected newest-first, which is how the query asks for it; this
 * does not assume it, because a sort order is a thing a later edit can change
 * without noticing what depended on it.
 */
export function mostRecentPerTitle<T extends ReusableCandidate>(events: T[]): T[] {
  const best = new Map<string, T>();

  for (const event of events) {
    const existing = best.get(key(event.title));
    if (!existing || event.updatedAt > existing.updatedAt) {
      best.set(key(event.title), event);
    }
  }

  return [...best.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * What carries onto the new event, and what does not.
 *
 * Everything the form asks except **when** and **where**, which are the two
 * answers that are never the same twice: a copy of last month's date is a
 * mistake somebody has to notice, and a room is exclusive, so a reservation
 * cannot be shared by two evenings. The room picker and the date fields are
 * left exactly as a blank form leaves them.
 *
 * The host does not carry either. Whoever is filling the form in hosts what
 * they make (EVT-04), and this list includes events they only co-hosted — so
 * copying the host would quietly make somebody else's event again.
 */
export const CARRIED_FIELDS = [
  'title',
  'description',
  'richDescription',
  'imageUrl',
  'imageCredit',
  'imageCreditUrl',
  'imageFocusY',
  'visibility',
  'capacity',
  'waitlistEnabled',
  'priceCents',
  'currency',
  'category',
  'tags',
  'hasCost',
  'suggestedCents',
  'maturityLevel',
  'timezone',
] as const;
