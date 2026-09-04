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

  it('opens the co-op on the dashboard, where everybody lands', () => {
    // The dashboard is hoisted out and has no header of its own, so no section
    // matches — and `/admin/<slug>` must not drag Organising open by being a
    // prefix of its items' hrefs either. What is left is the default, and the
    // default is the co-op: Welcome, Commons, Directory.
    expect(openSectionLabel(sections, '/admin/maybeitsfate')).toBe('MaybeItsFate');
  });

  it('falls back to the co-op off the nav entirely', () => {
    expect(openSectionLabel(sections, '/login')).toBe('MaybeItsFate');
    expect(openSectionLabel(sections, null)).toBe('MaybeItsFate');
  });

  it('has nothing to open before a co-op is known', () => {
    // Signed in with no membership loaded yet: no community section exists, so
    // the fallback must not invent one.
    const empty = sidebarSections({ signedIn: true });
    expect(openSectionLabel(empty, '/member')).toBeNull();
  });

  it('opens whatever the co-op happens to be called', () => {
    // Found by id, not by label — the community section is named after the
    // co-op, so there is no string to look for. Even a co-op that calls itself
    // after one of the fixed sections gets its own.
    const awkward = sidebarSections({
      membership: { role: 'ADMIN', org: { name: 'Organising', slug: 'org' } },
      signedIn: true,
    });
    expect(awkward.find((s) => s.id === 'community')?.items[0].href).toBe(
      '/portal/org/handbook',
    );
    expect(openSectionLabel(awkward, '/admin/org')).toBe('Organising');
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
