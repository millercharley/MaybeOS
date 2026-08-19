import { sidebarSections, NavSection } from '@/lib/nav';

/**
 * One navigation, and it must not forget who you are.
 *
 * Two bugs, found from the member side and then the organiser side.
 *
 * First, every item in the member sidebar was about the member — RSVPs,
 * bookings, billing, profile — so signing in produced a membership admin panel
 * and no membership: no channels, no proposals, no directory, and no way to
 * look at a room in order to book one. Charley, 2026-08-18: "there seems to be
 * no way for a member to reach the actual Commons or portal... I'm stuck in the
 * settings."
 *
 * Then the mirror of it: an organiser got the admin tools and *nothing else*,
 * so the person running a co-op had no route to the co-op they run. Being an
 * admin is a role held in addition to being a member, not instead of it.
 *
 * None of these surfaces were new. They existed and worked; nothing linked to
 * them — which is the same failure as the hardcoded events pages, and why this
 * is a test rather than four lines in an array: unreachable working code is
 * indistinguishable from working software until somebody tries to use it.
 */
describe('the sidebar', () => {
  const hrefs = (sections: NavSection[]) =>
    sections.flatMap((s) => s.items.map((i) => i.href));

  const labels = (sections: NavSection[]) => sections.map((s) => s.label);

  const member = {
    role: 'MEMBER',
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate' },
  };
  const organiser = {
    role: 'ADMIN',
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate' },
  };

  describe('a member', () => {
    const sections = () => sidebarSections({ membership: member, signedIn: true });

    it('can reach the Commons, and the rest of the co-op', () => {
      expect(hrefs(sections())).toEqual(
        expect.arrayContaining([
          '/portal/maybeitsfate/commons',
          '/portal/maybeitsfate/directory',
          '/portal/maybeitsfate/events',
          // Without this a member can list bookings they have no way to make.
          '/portal/maybeitsfate/rooms',
        ]),
      );
    });

    it('keeps their own pages, and their own dashboard', () => {
      expect(hrefs(sections())).toEqual(
        expect.arrayContaining(['/member/maybeitsfate', '/member/maybeitsfate/events', '/member/maybeitsfate/billing', '/member/maybeitsfate/profile']),
      );
    });

    it('has no separate RSVPs item — it lives inside My Events', () => {
      // Hosting something and going to something are the same question asked
      // twice; two nav items answered it on neither screen.
      expect(hrefs(sections())).not.toContain('/member/maybeitsfate/rsvps');
    });

    it('is offered no organising tools', () => {
      expect(hrefs(sections()).some((h) => h.startsWith('/admin'))).toBe(false);
    });

    it('names the section after the co-op, so it reads as somewhere to go', () => {
      expect(labels(sections())).toContain('MaybeItsFate');
    });
  });

  describe('an organiser', () => {
    const sections = () => sidebarSections({ membership: organiser, signedIn: true });

    it('gets the organising tools', () => {
      expect(hrefs(sections())).toEqual(
        expect.arrayContaining(['/admin/maybeitsfate/members', '/admin/maybeitsfate/tiers', '/admin/maybeitsfate/settings']),
      );
    });

    it('still gets the co-op they are organising — the bug this fixes', () => {
      // An admin who cannot reach their own Commons is the mirror of a member
      // who cannot: same defect, other side of the app.
      expect(hrefs(sections())).toContain('/portal/maybeitsfate/commons');
    });

    it('still gets their own membership pages', () => {
      // Being an admin is a role held in addition to being a member.
      expect(hrefs(sections())).toEqual(
        expect.arrayContaining(['/member/maybeitsfate/events', '/member/maybeitsfate/profile']),
      );
    });

    it('lands on the admin dashboard rather than the member one', () => {
      const links = hrefs(sections());
      expect(links).toContain('/admin/maybeitsfate');
      expect(links).not.toContain('/member/maybeitsfate');
    });

    it('separates the three with named sections', () => {
      expect(labels(sections())).toEqual(
        expect.arrayContaining(['MaybeItsFate', 'Organising', 'My membership']),
      );
    });
  });

  describe('every address names its co-op', () => {
    it('puts the slug in admin and membership links alike', () => {
      // `/admin` used to mean whichever org was in localStorage, so one address
      // meant different things to different people, two tabs could not sit on
      // two co-ops, and a stale selection made every screen answer 403 with no
      // way out (AUTH-05).
      const links = hrefs(sidebarSections({ membership: organiser, signedIn: true }));

      expect(links.filter((h) => h.startsWith('/admin')).every((h) => h.startsWith('/admin/maybeitsfate'))).toBe(true);
      expect(links.filter((h) => h.startsWith('/member')).every((h) => h.startsWith('/member/maybeitsfate'))).toBe(true);
    });

    it('builds no area links at all without a slug', () => {
      // There is no address to build: a bare `/admin` is now only a redirect.
      const links = hrefs(sidebarSections({ membership: { role: 'ADMIN' }, signedIn: true }));

      expect(links.some((h) => h.startsWith('/admin'))).toBe(false);
      expect(links.some((h) => h.startsWith('/member'))).toBe(false);
    });
  });

  describe('a signed-out visitor on a public portal', () => {
    const sections = () => sidebarSections({ orgSlug: 'maybeitsfate', signedIn: false });

    it('still sees the co-op, because the portal is public', () => {
      expect(hrefs(sections())).toContain('/portal/maybeitsfate/commons');
    });

    it('is offered nothing that would just bounce them to sign-in', () => {
      const links = hrefs(sections());
      expect(links.some((h) => h.startsWith('/member'))).toBe(false);
      expect(links.some((h) => h.startsWith('/admin'))).toBe(false);
    });
  });

  describe('which co-op the community section points at', () => {
    it('follows the page when looking at another co-op’s portal', () => {
      // Otherwise a visitor reading Sunrise's public page gets links to their
      // own co-op and is silently navigated somewhere else entirely.
      const links = hrefs(
        sidebarSections({ membership: member, orgSlug: 'sunrise', signedIn: true }),
      );

      expect(links).toContain('/portal/sunrise/commons');
      expect(links).not.toContain('/portal/maybeitsfate/commons');
    });

    it('falls back to the selected membership elsewhere', () => {
      expect(hrefs(sidebarSections({ membership: member, signedIn: true }))).toContain(
        '/portal/maybeitsfate/commons',
      );
    });

    it('builds no community links at all when there is no slug', () => {
      // `/portal/undefined/commons` reads as a broken product rather than a
      // profile that has not loaded yet.
      const links = hrefs(sidebarSections({ membership: { role: 'MEMBER' }, signedIn: true }));

      // Nothing at all, rather than `/portal/undefined/commons` or
      // `/member/undefined` — a half-built address reads as a broken product
      // rather than a profile that has not loaded yet.
      expect(links.some((h) => h.includes('undefined'))).toBe(false);
      expect(links).toEqual([]);
    });
  });
});
