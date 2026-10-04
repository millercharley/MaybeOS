import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BADGE_MAX,
  badgeDescription,
  badgeLabel,
  hasUnread,
  sectionUnread,
  unreadFor,
  unreadKeyFor,
} from '@/lib/unread';

/**
 * The red bubble in the navigation (CMN-14).
 *
 * Charley: "when there's an unread message in the Commons or Messages, a red
 * bubble appears in the navigation panel with a number indicating how many
 * messages need to be reviewed."
 */
const none = { messages: 0, commons: 0 };

describe('what the bubble says', () => {
  it('shows the number', () => {
    expect(badgeLabel(3)).toBe('3');
  });

  it('stops counting out loud past ninety-nine', () => {
    // The difference between 427 and 99+ changes nothing a member does —
    // both mean "more than you are reading now" — and a four-digit pill
    // wrecks the row it sits in.
    expect(badgeLabel(BADGE_MAX)).toBe('99');
    expect(badgeLabel(BADGE_MAX + 1)).toBe('99+');
    expect(badgeLabel(427)).toBe('99+');
  });

  it('is not drawn at zero', () => {
    expect(hasUnread(0)).toBe(false);
    expect(hasUnread(undefined)).toBe(false);
    expect(hasUnread(1)).toBe(true);
  });

  it('says something a screen reader can use', () => {
    // Announced as written, a bare "3" becomes "Messages 3" — which could be
    // a heading number or a count of channels.
    expect(badgeDescription(3, 'messages')).toBe('3 unread messages');
    expect(badgeDescription(1, 'messages')).toBe('1 unread message');
    expect(badgeDescription(1, 'commons')).toBe('1 unread post');
  });

  it('says the real number out loud even when the pill is capped', () => {
    expect(badgeDescription(427, 'messages')).toContain('427');
  });
});

describe('which nav item gets which count', () => {
  const counts = { messages: 2, commons: 5 };

  it('finds the two items by route, for any co-op', () => {
    expect(unreadFor('/portal/maybeitsfate/messages', counts)).toBe(2);
    expect(unreadFor('/portal/sunrise/commons', counts)).toBe(5);
    expect(unreadKeyFor('/portal/maybeitsfate/messages')).toBe('messages');
    expect(unreadKeyFor('/portal/maybeitsfate/commons')).toBe('commons');
  });

  it('leaves every other item alone', () => {
    for (const href of [
      '/portal/maybeitsfate/events',
      '/member/maybeitsfate',
      '/member/maybeitsfate/billing',
      '/admin/maybeitsfate/members',
    ]) {
      expect(unreadFor(href, counts)).toBe(0);
      expect(unreadKeyFor(href)).toBeNull();
    }
  });

  it('does not match a deeper page that merely sits under one', () => {
    // A single conversation is not the Messages item.
    expect(unreadFor('/portal/maybeitsfate/messages/abc-123', counts)).toBe(0);
  });
});

describe('a collapsed section', () => {
  it('carries the total of what it is hiding', () => {
    /*
      Collapsed sections unmount their links, so a badge on Messages is
      invisible exactly when the member is not already looking at the Commons
      — which is most of the time, and when an unread message matters most.
    */
    const hrefs = [
      '/portal/maybeitsfate/handbook',
      '/portal/maybeitsfate/commons',
      '/portal/maybeitsfate/messages',
      '/portal/maybeitsfate/events',
    ];
    expect(sectionUnread(hrefs, { messages: 2, commons: 5 })).toBe(7);
  });

  it('is silent when there is nothing behind it', () => {
    expect(sectionUnread(['/portal/x/commons', '/portal/x/messages'], none)).toBe(0);
  });
});

/**
 * Two things about the badge that live in the markup, and that a number
 * cannot check.
 */
describe('the badge in the sidebar', () => {
  const badge = readFileSync(
    join(__dirname, '..', 'components/layout/unread-badge.tsx'),
    'utf8',
  );
  const sidebar = readFileSync(
    join(__dirname, '..', 'components/layout/sidebar.tsx'),
    'utf8',
  );

  it('is red, and not the brand red the selected row is painted with', () => {
    // `bg-brand-600` is the active row's own background. A brand-red pill on
    // a brand-red row is an invisible badge.
    expect(badge).toContain('var(--danger)');
    expect(badge).toContain('onActiveRow');
  });

  it('gives the label something to push against', () => {
    // The nav row is `flex items-center gap-3` with no `justify-between`, and
    // the label used to be a bare text node — nothing for `ml-auto` to work
    // from, so the badge would have sat against the text.
    expect(sidebar).toContain('flex-1 truncate">{item.label}');
  });
});
