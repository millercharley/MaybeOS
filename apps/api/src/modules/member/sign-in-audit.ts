/**
 * Reconciling the migration send against what the provider actually did
 * (MEM-24).
 *
 * `sendSignInLinks` marks `signInSentAt` inside the transaction that mints the
 * magic-link token, before Postmark is called. That order is deliberate — a
 * crash between the two must not leave a live token nobody knows about — but
 * it means the mark records an *attempt*. The first real migration send is
 * what that distinction costs: the Postmark plan stopped accepting at a
 * hundred messages, MaybeOS marked four hundred and thirty-five, and the
 * remaining three hundred and thirty-five were, as far as every screen in
 * MaybeOS was concerned, people who had been told. They were waiting for an
 * email that was never going to arrive, and pressing "send the next batch"
 * found nobody left to send to.
 *
 * Everything here is a pure function over what Postmark reports, so the
 * matching rules can be tested without a provider or a database.
 */

/**
 * Stamped on every sign-in message from now on.
 *
 * The messages already sent do not carry it, which is why the matching below
 * also works by subject — but a tag is an exact answer where a subject is an
 * inference, and every future audit should get the exact one.
 */
export const SIGN_IN_TAG = 'sign-in-link';

/** How long Postmark keeps message records on the plans MaybeOS uses. */
export const POSTMARK_RETENTION_DAYS = 45;

/** One outbound message, reduced to the fields the audit reasons about. */
export interface AuditMessage {
  /** Everyone it reached — Postmark's `Recipients`, which includes the Cc. */
  recipients: string[];
  subject: string;
  tag?: string | null;
  receivedAt: string;
}

/** One bounce, likewise reduced. */
export interface AuditBounce {
  email: string;
  /** Postmark's `Type`: HardBounce, SpamComplaint, Transient… */
  type: string;
  bouncedAt: string;
}

export type SignInOutcome = 'delivered' | 'bounced' | 'missing';

export interface SignInVerdict {
  outcome: SignInOutcome;
  /** When Postmark accepted it, or when it bounced. Null when missing. */
  at: Date | null;
  /** Human wording for a bounce, null otherwise. */
  kind: string | null;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Every address one member reads, lowercased.
 *
 * Both of them, because a sign-in link goes to the primary with the alternate
 * copied (MEM-19) and Postmark lists the Cc among the recipients. Matching on
 * the primary alone would call a delivered message missing for exactly the
 * members whose two addresses were the reason for the feature.
 */
export function memberAddresses(member: {
  email?: string | null;
  altEmail?: string | null;
}): string[] {
  const all = [normalizeEmail(member.email), normalizeEmail(member.altEmail)];
  return [...new Set(all.filter(Boolean))];
}

/**
 * Is this one of the sign-in messages?
 *
 * By tag when the tag is there, by subject otherwise. The subject of a sign-in
 * email is the same for everybody in an org — the template substitutes the
 * community name and nothing per-person into it — so an exact match is sound.
 * It is not *robust*: an admin who rewords the subject after sending breaks
 * it, and the audit refuses to draw conclusions when that happens rather than
 * reporting everybody as unsent (see `inconclusive`).
 */
export function isSignInMessage(
  message: AuditMessage,
  expectedSubject: string,
): boolean {
  if (message.tag && message.tag === SIGN_IN_TAG) return true;
  return normalizeSubject(message.subject) === normalizeSubject(expectedSubject);
}

function normalizeSubject(subject: string): string {
  return subject.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * address → when Postmark accepted a sign-in message for it.
 *
 * The earliest wins. A member who was written to twice was reached the first
 * time, and that is the date that answers "has this person been told".
 */
export function indexDelivered(
  messages: AuditMessage[],
  expectedSubject: string,
): Map<string, Date> {
  const found = new Map<string, Date>();

  for (const message of messages) {
    if (!isSignInMessage(message, expectedSubject)) continue;

    const at = new Date(message.receivedAt);
    if (Number.isNaN(at.getTime())) continue;

    for (const recipient of message.recipients.map(normalizeEmail).filter(Boolean)) {
      const already = found.get(recipient);
      if (!already || at < already) found.set(recipient, at);
    }
  }

  return found;
}

/**
 * address → the bounce against it. The most recent wins.
 *
 * Unlike delivery, the latest is what matters: an address that bounced in
 * March and was fixed in April should not read as broken, and the newest
 * record is the one that reflects the address as it stands.
 */
export function indexBounces(bounces: AuditBounce[]): Map<string, AuditBounce> {
  const found = new Map<string, AuditBounce>();

  for (const bounce of bounces) {
    const email = normalizeEmail(bounce.email);
    if (!email) continue;

    const at = new Date(bounce.bouncedAt).getTime();
    if (Number.isNaN(at)) continue;

    const already = found.get(email);
    if (!already || at > new Date(already.bouncedAt).getTime()) found.set(email, bounce);
  }

  return found;
}

/**
 * Postmark's bounce types in words an admin can act on.
 *
 * The distinction that matters is whether to fix the address or leave the
 * person alone: a hard bounce is a typo or a closed account, a spam complaint
 * is somebody who asked not to be written to and must not be written to again.
 */
export function bounceKind(type: string): string {
  const known: Record<string, string> = {
    HardBounce: 'Hard bounce — the address does not exist',
    SoftBounce: 'Soft bounce — the mailbox turned it away',
    Transient: 'Temporary problem — worth another try',
    BadEmailAddress: 'Not a valid address',
    DnsError: "The domain's mail server could not be found",
    Blocked: 'The receiving server blocked it',
    SpamComplaint: 'Marked as spam — do not write again',
    SpamNotification: 'Filed as spam by the receiving server',
    ManuallyDeactivated: 'Deactivated in Postmark',
    Unsubscribe: 'Unsubscribed',
    DMARCPolicy: 'Refused by the domain’s DMARC policy',
    Unknown: 'Postmark could not say why',
  };
  return known[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Bounces that mean "never write here again", whatever the admin does. */
export function isPermanentRefusal(type: string): boolean {
  return type === 'SpamComplaint' || type === 'Unsubscribe';
}

/**
 * What happened to one member's link.
 *
 * A bounce outranks a delivery: Postmark accepted the message — which is what
 * a delivery record means — and the receiving server then refused it. The
 * member did not get it either way, and the bounce is the useful half.
 */
export function verdictFor(
  addresses: string[],
  delivered: Map<string, Date>,
  bounced: Map<string, AuditBounce>,
): SignInVerdict {
  for (const address of addresses) {
    const bounce = bounced.get(address);
    if (bounce) {
      return {
        outcome: 'bounced',
        at: new Date(bounce.bouncedAt),
        kind: bounceKind(bounce.type),
      };
    }
  }

  for (const address of addresses) {
    const at = delivered.get(address);
    if (at) return { outcome: 'delivered', at, kind: null };
  }

  return { outcome: 'missing', at: null, kind: null };
}

/**
 * Has the send window aged out of Postmark's retention?
 *
 * Worth saying out loud, because an audit run too late looks exactly like an
 * audit that found nothing was ever sent, and the two call for opposite
 * actions.
 */
export function beyondRetention(earliest: Date, now: Date): boolean {
  const days = (now.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000);
  return days > POSTMARK_RETENTION_DAYS;
}

/**
 * When must the audit refuse to answer?
 *
 * When it recognised none of the messages Postmark does have in the window.
 * That is the signature of matching having broken — a reworded subject, a
 * different message stream — and the failure is not symmetric: reporting
 * everybody as unsent sends a second copy to the people who already have one,
 * on the strength of a guess. Saying "I could not tell" costs nothing.
 *
 * Finding no messages at all is different, and conclusive: the provider
 * accepted nothing, which is precisely what a quota rejection looks like.
 */
export function inconclusive(counts: {
  messagesInWindow: number;
  signInMessagesMatched: number;
}): boolean {
  return counts.messagesInWindow > 0 && counts.signInMessagesMatched === 0;
}

/** Which members a re-send is for. */
export type ResendScope = 'waiting' | 'undelivered' | 'not-signed-in';

export const RESEND_SCOPES: ResendScope[] = ['waiting', 'undelivered', 'not-signed-in'];

/**
 * The filter behind each scope.
 *
 * Shaped as a Prisma `where` but written here, beside the rules it encodes, so
 * that the one thing capable of writing to several hundred inboxes can be
 * read and tested as a list of conditions.
 *
 * Every scope excludes a bounced address. Re-sending to one cannot work — the
 * address is wrong or its owner has refused — and it spends quota that the
 * people who *can* be reached need. A bounce is a job for the admin: fix the
 * address, which clears the flag and moves that member into `undelivered`.
 */
export function scopeFilter(scope: ResendScope): Record<string, unknown> {
  // Nobody with a password: they have signed in and chosen one, so they know
  // the way in and do not need telling. True of every scope.
  const noPassword = { passwordHash: null };

  switch (scope) {
    /** Never written to at all. The original migration send. */
    case 'waiting':
      return { signInSentAt: null, signInBouncedAt: null, user: noPassword };

    /**
     * Marked as sent, and Postmark has no record of it.
     *
     * The quota's victims. `signInAuditedAt` must be set — without it this
     * reads "nobody has checked yet", which is every member who was sent a
     * link before this audit existed.
     */
    case 'undelivered':
      return {
        signInSentAt: { not: null },
        signInAuditedAt: { not: null },
        signInDeliveredAt: null,
        signInBouncedAt: null,
        user: noPassword,
      };

    /**
     * Reached, and still has not come in.
     *
     * A nudge rather than a repair: the link arrived, nothing was broken, and
     * the member has not acted on it. `lastLoginAt` is the honest test —
     * `signInSentAt` says only that MaybeOS wrote to them.
     */
    case 'not-signed-in':
      return {
        signInDeliveredAt: { not: null },
        signInBouncedAt: null,
        user: { ...noPassword, lastLoginAt: null },
      };
  }
}

/**
 * What the admin is shown after an audit.
 *
 * `missing` and `neverSent` are deliberately separate counts even though both
 * are people without a link: one is a send that failed silently and the other
 * is a send that has not happened. They are reached by different buttons.
 */
export interface AuditTally {
  /** Marked as sent in MaybeOS — the number the old screen called "sent". */
  marked: number;
  delivered: number;
  bounced: number;
  missing: number;
  /** Delivered, but has never signed in. */
  stalled: number;
  /** Never marked as sent: the queue the original send works through. */
  neverSent: number;
}

/** The headline sentence, so the UI and the tests agree on the arithmetic. */
export function tallyLine(tally: AuditTally): string {
  if (tally.marked === 0) return 'No sign-in links have been sent yet.';

  const parts = [`${tally.delivered} reached`];
  if (tally.bounced) parts.push(`${tally.bounced} bounced`);
  if (tally.missing) parts.push(`${tally.missing} never actually sent`);

  return `Of ${tally.marked} marked as sent: ${parts.join(', ')}.`;
}

/**
 * A date in the form Postmark's message search takes, shifted by whole days.
 *
 * `YYYY-MM-DD` because that endpoint filters by date, not by timestamp. UTC,
 * so that an audit run from a different timezone than the send asks about the
 * same days.
 */
export function postmarkDay(from: Date, shiftDays = 0): string {
  const shifted = new Date(from.getTime() + shiftDays * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}
