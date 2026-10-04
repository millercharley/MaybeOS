/**
 * What the sidebar badges need (CMN-14).
 *
 * Two numbers and nothing else. This is fetched on a timer by every signed-in
 * page, so anything that is not a count does not belong in it — least of all
 * the messages themselves.
 */
export interface UnreadCounts {
  /** Direct messages addressed to this member and not yet opened. */
  messages: number;
  /** Posts and comments in the co-op's channels they have not seen. */
  commons: number;
}
