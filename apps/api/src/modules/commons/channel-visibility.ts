/**
 * Who can see a channel that is not public (CMN-30).
 *
 * `Channel.isPublic` has existed since the Commons was built. `createChannel`
 * defaults it to true, `updateChannel` writes whatever it is sent, both DTOs
 * accept it from a client — and **nothing has ever read it**. The schema said
 * so out loud, on `memberChannelsEnabled`: "Channels are open to the whole
 * co-op either way — see `Channel.isPublic`, which nothing enforces."
 *
 * So this was not dead code, which is what the card called it. It was a
 * setting that lied: an organiser could mark a channel not-public, MaybeOS
 * would store exactly that, and then show the channel and every post in it to
 * the whole co-op. A dead column is untidy; a switch that reports success and
 * does nothing is how somebody ends up writing something they believed was
 * private in front of four hundred people.
 *
 * ## What "not public" means here, and what it does not
 *
 * **Organisers only** — ADMIN and STAFF. Not "these particular members".
 *
 * That is the honest limit of the current model: there is no channel
 * membership anywhere in the schema. `inviteToChannel` sends a direct message
 * saying "come and join", and the controller says plainly that it "grants no
 * access". Private-to-a-chosen-few would need a membership table, a way to
 * add and remove people, and a way to leave — a feature, not a fix.
 *
 * Organisers-only is worth having on its own: somewhere to discuss a member's
 * dues, a complaint, or a safeguarding question is the thing a co-op actually
 * asks for, and until now the only answer was "not in MaybeOS".
 */

export interface ChannelAudience {
  isPublic: boolean;
}

export interface Viewer {
  /** ADMIN or STAFF in this org, or a platform admin. */
  isStaff: boolean;
}

/** Whether this viewer may see the channel at all. */
export function canSeeChannel(channel: ChannelAudience, viewer: Viewer): boolean {
  return channel.isPublic || viewer.isStaff;
}

/**
 * The Prisma clause that hides what a viewer may not see.
 *
 * Empty for an organiser rather than `{ isPublic: { in: [true, false] } }`,
 * so the common query is the query it always was.
 *
 * Returned as a fragment to spread into an existing `where`, because the
 * four scoped finders in `commons.service.ts` already carry an org clause
 * and the point is to add to it rather than replace it.
 */
export function visibleChannelWhere(viewer: Viewer): { isPublic?: true } {
  return viewer.isStaff ? {} : { isPublic: true };
}

/**
 * The same, for a row that *hangs off* a channel — a post, a comment, a
 * proposal.
 *
 * `{}` would be spread into `channel: {}` and match everything, which is
 * correct for an organiser and would be a silent hole if the caller forgot
 * the difference. Kept as one function so no caller has to remember.
 */
export function visibleChannelRelation(viewer: Viewer): { isPublic?: true } {
  return visibleChannelWhere(viewer);
}
