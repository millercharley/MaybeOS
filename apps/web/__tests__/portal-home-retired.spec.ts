import { readFileSync } from 'fs';
import { join } from 'path';
import { tenantAreaPath } from '@/lib/tenant-host';

/**
 * The portal home is My Dashboard now (NAV-04).
 *
 * Charley: "I don't think we need this page because it's redundant with My
 * Dashboard. Please redirect or simply make the landing page after sign in or
 * from the 'Enter Member Portal' route to this page."
 *
 * Retiring a page is mostly about what else was on it. Two of these tests are
 * about the redirect; the rest are about the things that would have gone with
 * it quietly.
 */
const web = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('the portal home', () => {
  const page = web('app/(app)/portal/[orgSlug]/page.tsx');

  it('redirects to the member dashboard', () => {
    expect(page).toContain("redirect(`/member/${orgSlug}`)");
  });

  it('is not a client component, so it never renders the old page', () => {
    // A client `router.replace` in an effect paints the portal home, then
    // navigates away from it — visible, and on a slow connection quite visible.
    expect(page).toContain("from 'next/navigation'");
    expect(page).not.toContain("'use client'");
  });

  it('is declared in next.config too, so the hop is a real 307', () => {
    /*
      Checked against the deployed site: a `redirect()` in a page nested under
      a client layout does not come back as an HTTP redirect. It is a 200 whose
      payload tells the router to navigate, so the shell paints first. The
      config entry moves the decision to the edge, before React exists.

      Not `permanent` — a 308 is cached by the browser for good, and an address
      we might want back should not be un-takeable.
    */
    const config = web('next.config.ts');

    expect(config).toContain("source: '/portal/:orgSlug'");
    expect(config).toContain("destination: '/member/:orgSlug'");
    expect(config).toContain('permanent: false');
  });
});

describe('what the portal home was carrying', () => {
  const dashboard = web('app/(app)/(dashboard)/member/[orgSlug]/page.tsx');

  // `WelcomeCard` had exactly one call site in the product, and it was the
  // page being retired. Redirecting without it would have deleted a feature
  // while appearing to remove a duplicate.
  it('WelcomeCard moved to the dashboard', () => {
    expect(dashboard).toContain('<WelcomeCard');
  });

  it('HappeningNow came too, and then went — it was the duplicate', () => {
    /*
      Charley, once he saw it there: "it turns out this is redundant with the
      Today at MaybeItsFate section." It was — that panel lists what is on
      today and badges the one running, so a strip above it reading "one room
      in use: Attic until 12:00" was the same fact told worse, naming a room
      rather than the event in it.

      Still in the product, on the admin dashboard, where room occupancy is
      somebody's actual job. This is the test that stops it drifting back.
    */
    expect(dashboard).not.toContain('<HappeningNow');

    const admin = web('app/(app)/(dashboard)/admin/[orgSlug]/page.tsx');
    expect(admin).toContain('<HappeningNow');
  });

  it('still shows what the member themselves is serving today', () => {
    expect(dashboard).toContain('<ServingToday');
  });
});

describe('the ways in', () => {
  it('sends "Enter Member Portal" straight to the dashboard', () => {
    const publicPage = web('app/(public)/orgs/[slug]/page.tsx');
    // The label as a JSX text node, not as a substring: the comment above
    // that button quotes it while explaining why joining leads.
    const label = publicPage.match(/>\s*Enter Member Portal\s*</);
    expect(label).not.toBeNull();

    const open = publicPage.lastIndexOf('<Link', label!.index);
    expect(publicPage.slice(open, label!.index)).toContain('/member/${slug}');
  });

  it('points the breadcrumb co-op name at the dashboard', () => {
    expect(web('app/(app)/layout.tsx')).not.toContain('href={`/portal/${coopSlug}`}');
  });
});

/**
 * The hazard the redirect walks into on a tenant subdomain.
 *
 * `sunrise.maybeos.org/` rewrites to `/portal/sunrise`, which now sends the
 * browser to `/member/sunrise` — and the old rewrite would have turned that
 * into `/member/sunrise/sunrise`, which is not a route. The tenant root would
 * have 404'd.
 */
describe('a tenant subdomain', () => {
  const AREAS = ['/admin', '/member'];

  it('puts the co-op into a path that lacks it', () => {
    expect(tenantAreaPath('/member', 'sunrise', AREAS)).toBe('/member/sunrise');
    expect(tenantAreaPath('/admin/members', 'sunrise', AREAS)).toBe('/admin/sunrise/members');
  });

  it('leaves a path that already names the co-op alone', () => {
    expect(tenantAreaPath('/member/sunrise', 'sunrise', AREAS)).toBeNull();
    expect(tenantAreaPath('/member/sunrise/billing', 'sunrise', AREAS)).toBeNull();
  });

  it('keeps the rest of the path when it does rewrite', () => {
    expect(tenantAreaPath('/member/billing', 'sunrise', AREAS)).toBe('/member/sunrise/billing');
  });

  it('ignores paths outside the co-op-scoped areas', () => {
    expect(tenantAreaPath('/login', 'sunrise', AREAS)).toBeNull();
    expect(tenantAreaPath('/', 'sunrise', AREAS)).toBeNull();
  });

  it('does not mistake another co-op\'s slug for the tenant\'s own', () => {
    // Somebody on sunrise.maybeos.org following a link to a different co-op
    // must not have it rewritten under sunrise.
    expect(tenantAreaPath('/member/oakwood', 'sunrise', AREAS)).toBe(
      '/member/sunrise/oakwood',
    );
  });
});
