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
  /**
   * The same total, split by channel — `{ [channelId]: count }` (CMN-27).
   *
   * Added because the badge was unactionable without it. The sidebar said
   * "Commons 2" and the Commons page gave no hint which channel held them, so
   * a member opened the Commons, read the channel it happened to land on, and
   * the 2 stayed — for days. Charley: "Why the 2 messages for new messages
   * when no new messages?"
   *
   * Channels with nothing unread are left out rather than sent as zero. This
   * is fetched on a sixty-second timer by every signed-in page, and a co-op
   * with forty channels should not pay for thirty-nine noughts.
   */
  channels: Record<string, number>;
}
