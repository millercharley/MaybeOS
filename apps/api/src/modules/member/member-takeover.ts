/**
 * Taking an address back from an account that was removed (MEM-28).
 *
 * Charley, deduplicating the migration: he removed Evan's non-paying duplicate
 * and then could not give the correct address to the paying one, because
 * "another member already uses that address". Nobody did. Removing a member
 * deletes their *membership*, not their *account*, and the husk left behind
 * went on holding the address — while the check that refused could not tell a
 * husk from a living member.
 *
 * The husk is rarely empty. Evan's held three imported room reservations and
 * two share grants totalling 300 shares, which is why this is a takeover
 * rather than a delete: the things it carries belong to the person, and the
 * person is the member who is still here.
 */

/** Everything a takeover knows how to carry across. */
export interface HuskContents {
  bookings: number;
  shareGrants: number;
  shares: number;
}

/**
 * Things a delete would destroy rather than preserve.
 *
 * Only the relations that cascade from a user. Everything else either survives
 * the delete unlinked (a hosted event, a share grant — `SetNull` by design) or
 * refuses it outright (a booking, a comment — a required relation, which
 * Postgres will not orphan). Those two are safe on their own; these are not,
 * so they are counted before anything is written.
 *
 * `ChannelRead` is deliberately absent. It records how far somebody had read,
 * it is meaningless for an account nobody ever signed into, and blocking a
 * takeover on it would be refusing to fix a real problem over a read receipt.
 */
export interface HuskBlockers {
  threadMessages: number;
  threadParticipations: number;
  messageReactions: number;
  commentReactions: number;
  attachments: number;
  coHostings: number;
}

export type TakeoverRefusal =
  /** No account holds that address, so there is nothing to take over. */
  | 'nothing-to-take'
  /** It belongs to somebody who is still a member somewhere. */
  | 'still-a-member'
  /** Somebody signs in with it. */
  | 'in-use'
  /** It carries things this cannot move, which would be destroyed. */
  | 'carries-things'
  /** The member already has that address. */
  | 'already-theirs';

export interface Holder {
  id: string;
  memberships: number;
  hasPassword: boolean;
  hasSignedIn: boolean;
}

/**
 * May this address be taken over?
 *
 * The order matters. "Still a member" is checked before "in use", because an
 * admin whose colleague simply has this address needs to hear that and not a
 * sentence about passwords.
 */
export function takeoverRefusal(
  holder: Holder | null,
  survivorId: string,
  blockers: HuskBlockers,
): TakeoverRefusal | null {
  if (!holder) return 'nothing-to-take';
  if (holder.id === survivorId) return 'already-theirs';
  if (holder.memberships > 0) return 'still-a-member';

  /*
    An account with a password, or one that has been signed into, is somebody's
    way in — whatever co-op they have since left. Taking its address would take
    their login, and no roster tidy-up is worth that.
  */
  if (holder.hasPassword || holder.hasSignedIn) return 'in-use';

  if (blocking(blockers).length > 0) return 'carries-things';

  return null;
}

/** Which blockers are non-zero, named for the admin. */
export function blocking(blockers: HuskBlockers): string[] {
  const named: Array<[keyof HuskBlockers, string, string]> = [
    ['threadMessages', 'message', 'messages'],
    ['threadParticipations', 'conversation', 'conversations'],
    ['messageReactions', 'reaction', 'reactions'],
    ['commentReactions', 'reaction on a comment', 'reactions on comments'],
    ['attachments', 'uploaded file', 'uploaded files'],
    ['coHostings', 'event it co-hosts', 'events it co-hosts'],
  ];

  return named
    .filter(([key]) => blockers[key] > 0)
    .map(([key, one, many]) => `${blockers[key]} ${blockers[key] === 1 ? one : many}`);
}

/** What the admin is told, for each way this can be refused. */
export function refusalMessage(
  reason: TakeoverRefusal,
  blockers: HuskBlockers,
): string {
  switch (reason) {
    case 'nothing-to-take':
      return 'No account holds that address, so there is nothing in the way. Saving the address again should work.';
    case 'already-theirs':
      return 'That is already their address.';
    case 'still-a-member':
      return 'That address belongs to somebody who is still a member of a community on MaybeOS. Only an address left behind by a removed member can be taken over.';
    case 'in-use':
      return 'Somebody signs in with that address. Taking it over would take their way in, so this will not do it.';
    case 'carries-things':
      return `That removed account still carries ${blocking(blockers).join(', ')}, which this cannot move. Nothing has been changed.`;
  }
}

/**
 * What the admin is about to move, in a sentence.
 *
 * Said before they press the button, because the point of a takeover is that
 * the husk is not empty — Evan's held three hundred shares. An admin who
 * presses "take the address" and silently inherits an ownership stake has not
 * been asked a fair question.
 */
export function movingSummary(contents: HuskContents): string {
  const parts: string[] = [];

  if (contents.shares > 0) {
    parts.push(
      `${contents.shares.toLocaleString('en-US')} share${contents.shares === 1 ? '' : 's'}` +
        ` across ${contents.shareGrants} grant${contents.shareGrants === 1 ? '' : 's'}`,
    );
  } else if (contents.shareGrants > 0) {
    parts.push(`${contents.shareGrants} share grant${contents.shareGrants === 1 ? '' : 's'}`);
  }

  if (contents.bookings > 0) {
    parts.push(
      `${contents.bookings} room reservation${contents.bookings === 1 ? '' : 's'}`,
    );
  }

  if (parts.length === 0) return 'It carries nothing else — only the address.';

  return `It still holds ${parts.join(' and ')}, which will move to this member.`;
}
