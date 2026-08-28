import { timeAgo, timeUntil } from '@/lib/relative-time';

describe('relative time', () => {
  const NOW = new Date('2026-08-28T12:00:00Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it('reads the way the reference does', () => {
    expect(timeAgo(ago(2 * 31536000_000), NOW)).toBe('2 years ago');
    expect(timeAgo(ago(10 * 2592000_000), NOW)).toBe('10 months ago');
    expect(timeAgo(ago(31536000_000), NOW)).toBe('a year ago');
  });

  it('says "just now" rather than a negative age when clocks disagree', () => {
    // Server and browser do not agree to the second, and "in -3 seconds" is
    // how that disagreement becomes visible to a member.
    expect(timeAgo(new Date(NOW.getTime() + 3000), NOW)).toBe('just now');
  });

  it('counts down without pluralising "a day"', () => {
    expect(timeUntil(new Date(NOW.getTime() + 6 * 86400_000), NOW)).toBe('in 6 days');
    expect(timeUntil(new Date(NOW.getTime() + 86400_000 + 1000), NOW)).toBe('in 1 day');
  });

  it('says "now" once the deadline has passed', () => {
    expect(timeUntil(ago(1000), NOW)).toBe('now');
  });
});
