/**
 * Who hears that somebody wrote to them (CMN-19).
 *
 * Until now, nothing: `sendToThread` wrote the message, bumped the thread and
 * marked the *sender's* own read state. A member found out they had been
 * written to if, and only if, they happened to come back and look — and of
 * MaybeItsFate's 443 members, 121 ever have.
 *
 * Charley's rule: a direct message emails immediately, and the Commons is a
 * weekly digest. This is the first half.
 *
 * Everything here is a pure function over rows, so the one decision that
 * decides whether this is a useful product or an inbox full of noise can be
 * read and tested without a database or a mail provider.
 */

/** One participant, reduced to what the decision turns on. */
export interface Participant {
  userId: string;
  /** Null until they open the thread: everything in it is unread. */
  lastReadAt: Date | null;
  /** When they were last told there was something here. Null means never. */
  notifiedAt: Date | null;
  /** Three-valued: true in, false out, null never asked. */
  emailOptIn: boolean | null;
  messageEmails: boolean;
  email: string | null;
  altEmail: string | null;
}

/**
 * Told once, and not again until they have looked.
 *
 * "Immediately" is the rule, and this is what keeps it from meaning "on every
 * line": two members talking inside MaybeOS would otherwise email each other
 * once per message. The *first* message into a quiet thread still goes out at
 * once, which is the case that matters — somebody who has drifted away being
 * told that a person is talking to them.
 *
 * Reading the thread resets it, so the next message after they have been in
 * emails immediately again.
 */
export function awaitingNotice(p: Pick<Participant, 'lastReadAt' | 'notifiedAt'>): boolean {
  // Never told. The first message into a thread, or into one they have never
  // opened and never been emailed about.
  if (!p.notifiedAt) return true;

  // Told, and they have not opened it since. They already know; a second
  // email says nothing the first did not.
  if (!p.lastReadAt) return false;

  // Told, and they have been in since. Whatever arrives now is news again.
  return p.lastReadAt.getTime() >= p.notifiedAt.getTime();
}

/**
 * Has this member switched this off, in either of the two places they can?
 *
 * `emailOptIn` is three-valued and the null is the trap: written as
 * `{ not: false }` in SQL it excludes the nulls, because `NULL <> false` is
 * NULL rather than true — and on a real co-op almost everybody is null,
 * never having been asked. Spelled out here so the same mistake cannot be
 * made twice.
 */
export function wantsEmail(p: Pick<Participant, 'emailOptIn' | 'messageEmails'>): boolean {
  if (p.emailOptIn === false) return false;
  return p.messageEmails;
}

/**
 * Everyone who should be emailed about a message just sent.
 *
 * The sender is never among them, which is worth stating rather than
 * assuming: a thread's participants include the person who just wrote.
 */
export function recipientsFor(participants: Participant[], senderId: string): Participant[] {
  return participants.filter(
    (p) =>
      p.userId !== senderId &&
      Boolean(p.email) &&
      wantsEmail(p) &&
      awaitingNotice(p),
  );
}

/** How much of a message the email carries. */
export const PREVIEW_LIMIT = 400;

/**
 * The message itself, trimmed to a readable length.
 *
 * Charley chose to put the text in the email: a notification that will not
 * say what was said is one people stop opening. The cost is that a private
 * message then lives in Gmail and Outlook as well as in MaybeOS, which is
 * his call to make and is made.
 *
 * Long messages are cut rather than sent whole — an email is a nudge, and the
 * conversation is the place to read it.
 */
export function preview(body: string): { text: string; truncated: boolean } {
  const text = body.trim().replace(/\s+/g, ' ');
  if (text.length <= PREVIEW_LIMIT) return { text, truncated: false };

  // Cut at a word boundary where there is one close enough to the limit, so
  // the preview does not end mid-word.
  const cut = text.slice(0, PREVIEW_LIMIT);
  const space = cut.lastIndexOf(' ');
  return { text: (space > PREVIEW_LIMIT - 60 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}
