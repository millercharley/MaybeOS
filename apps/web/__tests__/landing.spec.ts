import { landingPathFor } from '@/lib/landing';

/**
 * Where signing in puts you.
 *
 * Both sign-in paths hard-coded `/admin`, so every ordinary member who signed
 * in — by password or by the magic link they had just been emailed — landed on
 * "This page is for organisers" and had to spot the small link back to their
 * own dashboard. The rule is simpler since 2026-10-02: **everybody lands on
 * their own dashboard**, organiser or not, following the nav — the main
 * Dashboard is the member's for everyone, and Administration is a section an
 * organiser goes to rather than the place they are put.
 *
 * It cannot loop, which is what these cases are really for: only `/admin` is
 * gated, and `/member` refuses nobody who is a member.
 */
describe('landingPathFor', () => {
  const member = { globalRole: 'USER', orgs: [{ orgId: 'org-1', role: 'MEMBER' }] };
  const admin = { globalRole: 'USER', orgs: [{ orgId: 'org-1', role: 'ADMIN' }] };
  const staff = { globalRole: 'USER', orgs: [{ orgId: 'org-1', role: 'STAFF' }] };

  const path = (u: unknown, org?: string | null) =>
    landingPathFor(u as Parameters<typeof landingPathFor>[0], org);

  it('sends a member to their own dashboard', () => {
    expect(path(member)).toBe('/member');
  });

  it('sends admins and staff to their own dashboard too', () => {
    // Being an organiser is something you do in a co-op you belong to, and
    // signing in straight onto the admin screens said the opposite.
    expect(path(admin)).toBe('/member');
    expect(path(staff)).toBe('/member');
  });

  it('sends a platform admin to /admin regardless of org role', () => {
    expect(path({ globalRole: 'PLATFORM_ADMIN', orgs: [] })).toBe('/admin');
  });

  it('lands the same way whichever co-op is selected', () => {
    // Somebody can be an admin of one co-op and a plain member of another.
    // The old rule had to read the role of whichever org the layout was about
    // to show, or it dropped them on the locked page; there is nothing left
    // to get wrong now.
    const both = {
      globalRole: 'USER',
      orgs: [
        { orgId: 'org-1', role: 'ADMIN' },
        { orgId: 'org-2', role: 'MEMBER' },
      ],
    };

    expect(path(both, 'org-2')).toBe('/member');
    expect(path(both, 'org-1')).toBe('/member');
  });

  it('falls back to the first org, which is the one the layout auto-selects', () => {
    const both = {
      globalRole: 'USER',
      orgs: [
        { orgId: 'org-1', role: 'MEMBER' },
        { orgId: 'org-2', role: 'ADMIN' },
      ],
    };

    expect(path(both, null)).toBe('/member');
  });

  it('does not send a brand new user with no orgs to a locked page', () => {
    expect(path({ globalRole: 'USER', orgs: [] })).toBe('/member');
  });
});
