import { navSectionsFor, portalSectionsFor } from '@/lib/nav';

/**
 * A member must have a route to their own co-op.
 *
 * Every item in the member sidebar was about the member — RSVPs, events,
 * bookings, billing, profile — so signing in produced a membership admin
 * panel and no membership. No channels, no proposals, no library, no
 * directory, and no way to look at a room in order to book one, which is why
 * "My Bookings" could only ever be empty for them. The admin sidebar had
 * carried a Commons link the whole time.
 *
 * Charley found it from the member side on 2026-08-18: "there seems to be no
 * way for a member to reach the actual Commons or portal... I'm stuck in the
 * settings." The surfaces already existed and already handled a signed-in
 * member correctly. Nothing linked to them — the same failure as the
 * hardcoded events pages, which is what makes it worth a test rather than a
 * one-line fix: unreachable working code looks identical to working software.
 */
describe('the member sidebar', () => {
  const hrefs = (sections: ReturnType<typeof navSectionsFor>) =>
    sections.flatMap((s) => s.items.map((i) => i.href));

  const member = {
    role: 'MEMBER',
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate' },
  };

  it('gives a member a way into the Commons', () => {
    expect(hrefs(navSectionsFor(member))).toContain('/portal/maybeitsfate/commons');
  });

  it('offers the rest of the co-op too, not only the Commons', () => {
    const links = hrefs(navSectionsFor(member));
    expect(links).toEqual(
      expect.arrayContaining([
        '/portal/maybeitsfate/directory',
        '/portal/maybeitsfate/events',
        // Without this a member can list bookings they have no way to make.
        '/portal/maybeitsfate/rooms',
      ]),
    );
  });

  it('still gives them their own pages', () => {
    const links = hrefs(navSectionsFor(member));
    expect(links).toEqual(
      expect.arrayContaining(['/member', '/member/rsvps', '/member/billing', '/member/profile']),
    );
  });

  it('names the section after the co-op, so it reads as somewhere to go', () => {
    expect(navSectionsFor(member).map((s) => s.label)).toContain('MaybeItsFate');
  });

  it('builds no link at all when the slug is missing', () => {
    // `org` is optional on the profile, and `/portal/undefined/commons` would
    // read as a broken product rather than a profile that has not loaded.
    const links = hrefs(navSectionsFor({ role: 'MEMBER' }));

    expect(links.some((h) => h.includes('undefined'))).toBe(false);
    expect(links.some((h) => h.startsWith('/portal/'))).toBe(false);
    // The member's own pages survive the absence.
    expect(links).toContain('/member/profile');
  });

  it('leaves the organiser sidebar alone', () => {
    const links = hrefs(navSectionsFor({ role: 'ADMIN', org: { slug: 'maybeitsfate' } }));

    expect(links).toContain('/admin/commons');
    expect(links.some((h) => h.startsWith('/portal/'))).toBe(false);
    expect(links.some((h) => h.startsWith('/member'))).toBe(false);
  });
});

/**
 * The portal's own column (option B).
 *
 * One nav now carries both the co-op and the member's settings, so the two
 * halves of the product stop being separate apps. The constraint that shapes
 * it: **the portal is public**. A signed-out visitor is a legitimate viewer of
 * a co-op's page, so hiding the co-op section behind a session would hide a
 * co-op's public face from the public — which is the failure worth pinning.
 */
describe('the portal sidebar', () => {
  const hrefs = (sections: ReturnType<typeof portalSectionsFor>) =>
    sections.flatMap((s) => s.items.map((i) => i.href));

  const member = { role: 'MEMBER', org: { name: 'MaybeItsFate', slug: 'maybeitsfate' } };

  it('shows a signed-out visitor the co-op, and nothing personal', () => {
    const links = hrefs(portalSectionsFor({ orgSlug: 'maybeitsfate', signedIn: false }));

    expect(links).toContain('/portal/maybeitsfate/commons');
    expect(links).toContain('/portal/maybeitsfate/events');
    // A visitor has no membership and no admin; offering either would be a
    // guaranteed redirect to the sign-in page.
    expect(links.some((h) => h.startsWith('/member'))).toBe(false);
    expect(links.some((h) => h.startsWith('/admin'))).toBe(false);
  });

  it('gives a signed-in member a route back to their own settings', () => {
    const links = hrefs(portalSectionsFor({ orgSlug: 'maybeitsfate', membership: member, signedIn: true }));

    expect(links).toContain('/portal/maybeitsfate/commons');
    expect(links).toContain('/member');
    expect(links).toContain('/member/profile');
    expect(links.some((h) => h.startsWith('/admin'))).toBe(false);
  });

  it('gives an organiser the admin tools without taking away the co-op', () => {
    const organiser = { role: 'ADMIN', org: { name: 'MaybeItsFate', slug: 'maybeitsfate' } };
    const sections = portalSectionsFor({ orgSlug: 'maybeitsfate', membership: organiser, signedIn: true });
    const links = hrefs(sections);

    expect(links).toContain('/admin/members');
    expect(links).toContain('/portal/maybeitsfate/commons');
    expect(sections.map((s) => s.label)).toEqual(expect.arrayContaining(['Organising', 'My membership']));
  });

  it('points Home at the portal root rather than a sub-page', () => {
    const links = hrefs(portalSectionsFor({ orgSlug: 'maybeitsfate', signedIn: false }));
    expect(links).toContain('/portal/maybeitsfate');
  });
});
