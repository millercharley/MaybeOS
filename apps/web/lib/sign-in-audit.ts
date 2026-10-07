import type { ResendScope, SignInAudit } from './api';

/**
 * Reading the audit back to the admin (MEM-25).
 *
 * The screen this feeds used to report "sent to 435 members, nobody left
 * waiting" while three hundred and thirty-five of them had an empty inbox. It
 * was not lying — it was reporting `signInSentAt`, which is written before
 * Postmark is called and therefore records an attempt. The arithmetic here is
 * the correction, so it is kept out of the component and tested.
 */

/** Why the audit declined to answer, in words an admin can act on. */
export function auditRefusal(audit: SignInAudit): string | null {
  if (audit.checked) return null;

  switch (audit.reason) {
    case 'no-provider':
      return 'No email provider is configured here, so there is nothing to check against.';
    case 'nobody-sent':
      return 'No sign-in links have gone out yet, so there is nothing to check.';
    case 'unrecognised':
      return 'Your provider has messages from that day, but none of them look like the sign-in email — most likely the subject line has been edited since it went out. Nothing has been changed, because the safe reading would have been to call everybody unsent and write to them all again.';
    case 'incomplete':
      return 'The check ran out of time before it had read everything. Nothing has been written down. Press it again.';
    default:
      return 'The check could not be completed, and nothing has been changed.';
  }
}

/** One group the admin can write to, as the panel lists them. */
export interface Cohort {
  scope: ResendScope;
  count: number;
  /** The button. */
  action: string;
  /** Who these people are and why they are a group. */
  because: string;
  /** The one that matters most is the one a failed send created. */
  urgent: boolean;
}

/**
 * The groups worth offering, in the order they matter.
 *
 * "Never actually sent" leads because those people are waiting for an email
 * that is never going to arrive and nothing else in MaybeOS can see them. A
 * nudge to somebody who got their link is a courtesy; this is a repair.
 *
 * A group of nobody is left out entirely rather than shown as zero — the panel
 * is a list of things to do.
 */
export function cohorts(audit: SignInAudit): Cohort[] {
  const { tally } = audit;

  const all: Cohort[] = [
    {
      scope: 'undelivered',
      count: audit.checked ? tally.missing : 0,
      action: 'Send to these',
      because:
        'Marked as sent here, and your provider has no record of ever accepting the message. They are waiting for an email that was never sent.',
      urgent: true,
    },
    {
      scope: 'waiting',
      count: tally.neverSent,
      action: 'Send the next batch',
      because: 'Never written to at all — the queue the original send works through.',
      urgent: false,
    },
    {
      scope: 'not-signed-in',
      count: audit.checked ? tally.stalled : 0,
      action: 'Send another link',
      because:
        'Their link arrived and they have never signed in. Nothing is broken; this is a nudge.',
      urgent: false,
    },
  ];

  return all.filter((cohort) => cohort.count > 0);
}

/** The heading for one group, with its number. */
export function cohortTitle(cohort: Cohort): string {
  const people = `${cohort.count} ${cohort.count === 1 ? 'member' : 'members'}`;

  switch (cohort.scope) {
    case 'undelivered':
      return `${people} never actually got an email`;
    case 'waiting':
      return `${people} have not been written to yet`;
    case 'not-signed-in':
      return `${people} got their link and have not signed in`;
  }
}

/**
 * The sentence above the groups.
 *
 * Says what the provider found, and names the gap between that and what
 * MaybeOS had recorded, because that gap is the entire point of the panel.
 */
export function auditHeadline(audit: SignInAudit): string {
  if (!audit.checked) return '';

  const { tally } = audit;
  if (tally.marked === 0) return 'No sign-in links have gone out yet.';

  const parts = [`${tally.delivered} reached`];
  if (tally.bounced > 0) parts.push(`${tally.bounced} bounced`);
  if (tally.missing > 0) parts.push(`${tally.missing} never actually sent`);

  return `Of the ${tally.marked} MaybeOS had marked as sent: ${parts.join(', ')}.`;
}

/**
 * Is the gap big enough to name out loud?
 *
 * A handful of refusals in four hundred is ordinary. Three hundred is a plan
 * limit, and an admin who does not know that will press send and watch the same
 * thing happen, so the panel says it in as many words.
 */
export function looksLikeAQuotaWall(audit: SignInAudit): boolean {
  if (!audit.checked) return false;
  const { delivered, missing } = audit.tally;
  return missing >= 20 && missing > delivered;
}

/** When the check last ran, in the admin's own locale. */
export function checkedWhen(audit: SignInAudit): string {
  if (!audit.checkedAt) return '';
  const at = new Date(audit.checkedAt);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString();
}

/**
 * Can this bounce be cleared by the admin saying it is fixed?
 *
 * A broken address can. A spam complaint or an unsubscribe is a person who
 * asked not to be written to, and an admin pressing a button is not them
 * changing their mind. The API refuses these too — this is so the button is
 * not offered in the first place.
 */
export function bounceIsFixable(kind: string): boolean {
  return !/spam|unsubscrib/i.test(kind);
}
