import { sidebarSections } from '@/lib/nav';

/**
 * A co-op that does not teach has no Teaching item (TCH-01).
 *
 * This is the first thing in the nav conditioned on a setting, and it breaks
 * with how every other optional feature here works — Radar, Shares, Monthly
 * recap and the Commons all keep a permanent entry and let the *page* say the
 * feature is off.
 *
 * That is right for an organiser, who needs somewhere to go and turn it on,
 * and wrong for a member: an item that exists only to disappoint is worse
 * than no item. So the flag rides on the session and the item is filtered
 * out, and this is what stops somebody "tidying" it back to the old pattern.
 */
const membership = (role = 'MEMBER') => ({
  orgId: 'org-1',
  role,
  org: { id: 'org-1', name: 'Sunrise', slug: 'sunrise' },
});

/*
  The flag travels as `features`, not on the membership.

  Deliberately a separate argument: `sidebarSections` also takes an `orgSlug`
  for a portal page, where the co-op on screen is *not* the one you are a
  member of — and reading the flag off your own membership would then answer
  about the wrong co-op. The sidebar supplies it from the session.
*/
const nav = (teachingEnabled: boolean | undefined, role = 'MEMBER') =>
  sidebarSections({
    membership: membership(role) as never,
    signedIn: true,
    ...(teachingEnabled === undefined ? {} : { features: { teachingEnabled } }),
  });

const hrefs = (sections: ReturnType<typeof sidebarSections>) =>
  sections.flatMap((section) => section.items.map((item) => item.href));

describe('the Teaching item', () => {
  it('is there when the co-op runs teaching', () => {
    expect(hrefs(nav(true))).toContain('/portal/sunrise/teaching');
  });

  it('is absent when the co-op does not', () => {
    expect(hrefs(nav(false))).not.toContain('/portal/sunrise/teaching');
  });

  /**
   * Absent means absent, not "on". A caller that has not loaded the session
   * yet should show fewer things, never more — the same direction of failure
   * `visibleTo(false)` picks on the server.
   */
  it('is absent when nobody has said either way', () => {
    expect(hrefs(nav(undefined))).not.toContain('/portal/sunrise/teaching');
  });

  it('leaves every other item alone either way', () => {
    const off = hrefs(nav(false));
    const on = hrefs(nav(true));

    // Exactly one item differs, and it is the one this is about.
    expect(on.filter((href) => !off.includes(href))).toEqual(['/portal/sunrise/teaching']);
    expect(off.filter((href) => !on.includes(href))).toEqual([]);
  });

  /** An organiser gets the admin screen too, and loses it the same way. */
  it('gives an organiser the admin screen, and takes it away with the flag', () => {
    const on = hrefs(nav(true, 'ADMIN'));
    const off = hrefs(nav(false, 'ADMIN'));

    expect(on).toContain('/admin/sunrise/teaching');
    expect(off).not.toContain('/admin/sunrise/teaching');
  });

  /**
   * The filter matches a path suffix, so it must not catch something that
   * merely ends in the same letters. Nothing does today; this is what notices
   * the day somebody adds `/portal/:slug/student-teaching`.
   */
  it('matches the teaching route and not a lookalike', () => {
    const teaching = hrefs(nav(true)).filter((href) => href.includes('teaching'));
    expect(teaching).toEqual(['/portal/sunrise/teaching']);
  });
});
