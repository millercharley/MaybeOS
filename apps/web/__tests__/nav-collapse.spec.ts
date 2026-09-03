import { sidebarSections, openSectionLabel, activeNavHref, isNavItemActive } from '@/lib/nav';

/**
 * Only the section you are in stays open (NAV-01).
 *
 * Charley, 2026-09-03: "Collapse the sections where the user is not, meaning
 * only expand the section where the user has navigated to a page. So if as an
 * Admin I've navigated to Host Payouts, keep the Organizing section expanded,
 * and collapse My Membership."
 *
 * The trap this guards is prefix matching. Every organiser address starts with
 * `/admin/<slug>`, which is also the dashboard's own href — so a naive
 * `startsWith` makes the dashboard "contain" every page in the product, and
 * the same slug appears in three sections at once.
 */
describe('which nav section is open', () => {
  const organiser = {
    role: 'ADMIN',
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate' },
  };
  const sections = sidebarSections({ membership: organiser, signedIn: true });

  it('opens Organising on Host payouts, and nothing else', () => {
    expect(openSectionLabel(sections, '/admin/maybeitsfate/payouts')).toBe('Organising');
  });

  it('opens My membership on a member page', () => {
    expect(openSectionLabel(sections, '/member/maybeitsfate/bookings')).toBe('My membership');
  });

  it('opens the co-op on its portal', () => {
    expect(openSectionLabel(sections, '/portal/maybeitsfate/commons')).toBe('MaybeItsFate');
  });

  it('follows a page nested under an item', () => {
    // `/admin/<slug>/members/import` is Members, not the dashboard.
    expect(openSectionLabel(sections, '/admin/maybeitsfate/members/import')).toBe('Organising');
  });

  it('leaves every section closed on the dashboard itself', () => {
    // The dashboard is hoisted out and has no header of its own, so there is
    // no section to open — and `/admin/<slug>` must not drag Organising open
    // by being a prefix of its items' hrefs.
    expect(openSectionLabel(sections, '/admin/maybeitsfate')).toBeNull();
  });

  it('does not guess when the address is unknown', () => {
    expect(openSectionLabel(sections, '/login')).toBeNull();
    expect(openSectionLabel(sections, null)).toBeNull();
  });

  it('never opens two sections for one address', () => {
    // Events exists in both the co-op portal and the organising tools, under
    // the same slug. Whichever wins, it is one.
    const paths = [
      '/admin/maybeitsfate/events',
      '/portal/maybeitsfate/events',
      '/member/maybeitsfate/events',
    ];
    for (const path of paths) {
      const matched = sections.filter(
        (s) => s.label && s.items.some((i) => isNavItemActive(i.href, path)),
      );
      expect(matched).toHaveLength(1);
      expect(openSectionLabel(sections, path)).toBe(matched[0].label);
    }
  });
});

describe('which nav item is lit', () => {
  const organiser = {
    role: 'ADMIN',
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate' },
  };
  const sections = sidebarSections({ membership: organiser, signedIn: true });

  it('lights exactly one item, never the dashboard as well', () => {
    // The bug this replaces: Dashboard's href is `/admin/<slug>`, the root of
    // every organiser page, so on Host payouts two items came up red at once.
    expect(activeNavHref(sections, '/admin/maybeitsfate/payouts')).toBe(
      '/admin/maybeitsfate/payouts',
    );
  });

  it('lights the dashboard on the dashboard', () => {
    expect(activeNavHref(sections, '/admin/maybeitsfate')).toBe('/admin/maybeitsfate');
  });

  it('lights the parent item on a page nested under it', () => {
    expect(activeNavHref(sections, '/admin/maybeitsfate/members/import')).toBe(
      '/admin/maybeitsfate/members',
    );
  });

  it('lights nothing off the nav', () => {
    expect(activeNavHref(sections, '/login')).toBeNull();
  });
});

describe('isNavItemActive', () => {
  it('matches the page itself and pages under it', () => {
    expect(isNavItemActive('/portal/mif/rooms', '/portal/mif/rooms')).toBe(true);
    expect(isNavItemActive('/portal/mif/rooms', '/portal/mif/rooms/attic')).toBe(true);
  });

  it('does not match a sibling that merely starts the same', () => {
    // Without the `/` guard, Rooms would light up on `/portal/mif/roomsy`.
    expect(isNavItemActive('/portal/mif/rooms', '/portal/mif/roomsy')).toBe(false);
  });
});
