/**
 * Small, pure pieces of the member card (MEM-18): which icon a link gets, how
 * long ago something was, and where a post lives.
 */

export type SocialKind = 'instagram' | 'facebook' | 'linkedin' | 'twitter' | 'youtube' | 'github' | 'web';

const HOSTS: Array<[RegExp, SocialKind]> = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(facebook|fb)\.com$/, 'facebook'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(twitter|x)\.com$/, 'twitter'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)github\.com$/, 'github'],
];

/** The icon a link deserves, by its host. Anything unrecognised is the web. */
export function socialKind(url: string): SocialKind {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [pattern, kind] of HOSTS) if (pattern.test(host)) return kind;
  } catch {
    // A link that does not parse is still shown, just without a brand.
  }
  return 'web';
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** "today", "yesterday", "3 days ago", "2 weeks ago" — the way Circle says it. */
export function relativeTime(when: string | Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(when).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return plural(days, 'day');
  if (days < 30) return plural(Math.floor(days / 7), 'week');
  if (days < 365) return plural(Math.floor(days / 30), 'month');
  return plural(Math.floor(days / 365), 'year');
}

export function sinceLabel(when: string | Date): string {
  return new Date(when).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** A post in the Commons, opened on its channel and scrolled to. */
export function commonsPostHref(orgSlug: string, channelId: string, postId: string): string {
  return `/portal/${orgSlug}/commons?channel=${encodeURIComponent(channelId)}#post-${postId}`;
}
