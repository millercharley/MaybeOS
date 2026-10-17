/**
 * Emailing a Commons post to the whole roster (CMN-21).
 *
 * Charley: "compose a rich text message to the Commons with the option of
 * sending a copy of the message via email to all members… today I want to
 * send an email to all of the current members reminding them about
 * tomorrow's potluck."
 *
 * Unlike the weekly digest (CMN-20), this goes to **everybody**, whether or
 * not they have been in. That is the point of it: a potluck tomorrow is not
 * news that can wait for somebody to drift back.
 *
 * The decisions live here as pure functions because the two that matter —
 * who receives it, and when a send is finished — are the two that are
 * expensive to get wrong in front of four hundred people.
 */

/** One member, reduced to what deciding turns on. */
export interface Recipient {
  /** The membership id: `post_email_sends` records the membership, not the user. */
  id: string;
  userId: string;
  email: string | null;
  altEmail: string | null;
  emailOptIn: boolean | null;
  announcementEmails: boolean;
}

/**
 * Has this member asked not to be sent these?
 *
 * Two switches, and an announcement respects both. An organiser with
 * something urgent will be tempted to argue that this one is different; it
 * is not. A member who switched off a co-op's email and then received one
 * anyway has learned that the switch is decorative, and the next thing they
 * press is not a switch.
 */
export function wantsAnnouncements(m: Pick<Recipient, 'emailOptIn' | 'announcementEmails'>): boolean {
  // `emailOptIn` is three-valued and null means "never asked", which on a
  // real co-op is almost everybody.
  if (m.emailOptIn === false) return false;
  return m.announcementEmails;
}

/**
 * Who is still owed a copy.
 *
 * `alreadySent` carries the membership ids that have one. A roster-sized
 * send cannot finish inside one function invocation, so this is called again
 * and again until it returns nothing — and it must never hand back somebody
 * who has already been written to, because the retry is the normal case
 * rather than the exception.
 */
export function stillOwed(
  recipients: Recipient[],
  alreadySent: ReadonlySet<string>,
): Recipient[] {
  return recipients.filter(
    (m) => Boolean(m.email) && !alreadySent.has(m.id) && wantsAnnouncements(m),
  );
}

/** What one pass of the send reports back. */
export interface SendProgress {
  /** Sent during this pass. */
  sent: number;
  /** Written to across every pass so far. */
  total: number;
  /** Still owed a copy. Zero means finished. */
  remaining: number;
}

/**
 * Is there more to do?
 *
 * Spelled out rather than left to the caller comparing numbers, because the
 * caller is a browser loop that will keep going until this says stop.
 */
export function finished(progress: SendProgress): boolean {
  return progress.remaining === 0;
}

/**
 * A plain-text summary for the subject line and the opening.
 *
 * An announcement's post may have no title — the Commons composer does not
 * ask for one — so the subject falls back to the co-op's name. Better a
 * subject that says who it is from than one that says the first eight words
 * of a sentence.
 */
export function announcementSubject(orgName: string, title: string | null): string {
  const trimmed = (title ?? '').trim();
  return trimmed ? trimmed : `A message from ${orgName}`;
}
