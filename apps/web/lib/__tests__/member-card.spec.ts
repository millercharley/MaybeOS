import { commonsPostHref, relativeTime, sinceLabel, socialKind } from '../member-card';

/** Pieces of the member card (MEM-18). */
describe('socialKind', () => {
  it('knows the networks Circle shows icons for', () => {
    expect(socialKind('https://www.instagram.com/rebeccajnortonstudios/')).toBe('instagram');
    expect(socialKind('https://linkedin.com/in/ada')).toBe('linkedin');
    expect(socialKind('https://x.com/ada')).toBe('twitter');
    expect(socialKind('https://youtu.be/abc')).toBe('youtube');
    expect(socialKind('https://m.facebook.com/ada')).toBe('facebook');
  });

  it('treats anything else — including a lookalike — as a plain website', () => {
    expect(socialKind('https://www.psanctuary.org/')).toBe('web');
    expect(socialKind('https://instagram.com.evil.example/')).toBe('web');
    expect(socialKind('not a url')).toBe('web');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('reads the way Circle reads', () => {
    expect(relativeTime(ago(0), now)).toBe('today');
    expect(relativeTime(ago(1), now)).toBe('yesterday');
    expect(relativeTime(ago(3), now)).toBe('3 days ago');
    expect(relativeTime(ago(14), now)).toBe('2 weeks ago');
    expect(relativeTime(ago(7), now)).toBe('1 week ago');
    expect(relativeTime(ago(95), now)).toBe('3 months ago');
    expect(relativeTime(ago(800), now)).toBe('2 years ago');
  });
});

describe('sinceLabel', () => {
  it('is month and year', () => {
    expect(sinceLabel('2025-02-15T12:00:00Z')).toBe('February 2025');
  });
});

describe('commonsPostHref', () => {
  it('opens the post on its channel and scrolls to it', () => {
    expect(commonsPostHref('mif', 'c 1', 'p1')).toBe('/portal/mif/commons?channel=c%201#post-p1');
  });
});
