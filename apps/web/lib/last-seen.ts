/**
 * When somebody last got in (MEM-24).
 *
 * Charley, after sending 435 sign-in links: "Add last sign-in data to the
 * Member list in the Admin." The question behind it is who has actually
 * arrived, which during a migration is the only number that matters.
 */

/**
 * "Never", "Today", "Yesterday", "3 days ago", "Sep 14".
 *
 * Recent days in words and older ones as a date, because "47 days ago" is
 * arithmetic somebody has to undo, while "Aug 18" is a fact. The line between
 * them is a week, which is roughly how long a date stays easier to picture as
 * a distance than as a day.
 */
export function lastSeenLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'Never';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Never';

  // Whole days apart, by calendar day rather than by elapsed hours: somebody
  // who signed in at 11pm was here yesterday, not twenty hours ago.
  const startOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Whether to draw attention to it: somebody who has never been here. */
export function neverSignedIn(iso: string | null | undefined): boolean {
  return !iso;
}
