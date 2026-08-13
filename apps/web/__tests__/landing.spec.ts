import { landingPathFor } from '@/lib/landing';

/**
 * Where signing in puts you.
 *
 * Both sign-in paths hard-coded `/admin`, so every ordinary member who signed
 * in — by password or by the magic link they had just been emailed — landed on
 * "This page is for organisers" and had to spot the small link back to their
 * own dashboard. These cases pin the rule to the same test the dashboard
 * layout gate uses, because a redirect that disagrees with its gate is how you
 * get a loop.
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

  it('sends admins and staff to the organiser dashboard', () => {
    expect(path(admin)).toBe('/admin');
    expect(path(staff)).toBe('/admin');
  });

  it('sends a platform admin to /admin regardless of org role', () => {
    expect(path({ globalRole: 'PLATFORM_ADMIN', orgs: [] })).toBe('/admin');
  });

  it('reads the role for the org that is actually selected', () => {
    // Someone can be an admin of one co-op and a plain member of another.
    // Landing them on /admin while the layout is showing the co-op where they
    // are only a member produces the locked page all over again.
    const both = {
      globalRole: 'USER',
      orgs: [
        { orgId: 'org-1', role: 'ADMIN' },
        { orgId: 'org-2', role: 'MEMBER' },
      ],
    };

    expect(path(both, 'org-2')).toBe('/member');
    expect(path(both, 'org-1')).toBe('/admin');
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
