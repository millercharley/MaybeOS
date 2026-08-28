/**
 * "2 years ago", the way the reference reads it.
 *
 * Coarse on purpose. A Knowledge Center article's last activity line exists to
 * say whether this is alive or settled, and "posted 2 years ago" answers that
 * better than a date somebody has to do arithmetic on. Precision below a
 * minute would be false anyway — the row is not a chat.
 */
const UNITS: Array<[seconds: number, one: string, many: string]> = [
  [31536000, 'a year', 'years'],
  [2592000, 'a month', 'months'],
  [604800, 'a week', 'weeks'],
  [86400, 'a day', 'days'],
  [3600, 'an hour', 'hours'],
  [60, 'a minute', 'minutes'],
];

export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const then = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  // A clock skew of a few seconds should read as "just now", not "in -3
  // seconds". Server and browser do not agree to the second and never will.
  if (seconds < 60) return 'just now';

  for (const [unitSeconds, one, many] of UNITS) {
    const count = Math.floor(seconds / unitSeconds);
    if (count >= 1) return count === 1 ? `${one} ago` : `${count} ${many} ago`;
  }
  return 'just now';
}

/** "in 6 days" — the grace-period countdown. */
export function timeUntil(value: string | Date, now: Date = new Date()): string {
  const then = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor((then.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return 'now';

  for (const [unitSeconds, one, many] of UNITS) {
    const count = Math.floor(seconds / unitSeconds);
    if (count >= 1) return count === 1 ? `in ${one.replace(/^an? /, '1 ')}` : `in ${count} ${many}`;
  }
  return 'in under a minute';
}
