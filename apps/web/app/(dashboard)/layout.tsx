'use client';

import Link from 'next/link';
import { useRouter, usePathname, useParams } from 'next/navigation';
import { Lock, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette, OPEN_SEARCH_EVENT } from '@/components/layout/command-palette';
import { useAuthStore } from '@/lib/auth-store';
import { OrgSetup } from '@/components/setup/org-setup';
import { OrgMark } from '@/components/layout/org-mark';
import { brandStyle, brandTheme } from '@/lib/brand';

// Keyed by the last segment rather than the whole path: every address now
// carries a co-op slug in the middle, so a full-path key would have to be
// written per co-op.
const breadcrumbMap: Record<string, string> = {
  members: 'Members',
  tiers: 'Tiers & Dues',
  events: 'Events',
  rooms: 'Rooms & Booking',
  commons: 'Commons',
  expenses: 'Spending',
  settings: 'Settings',
  bookings: 'My Bookings',
  billing: 'Billing',
  profile: 'Profile',
};

/**
 * Paths written before the co-op moved into the address.
 *
 * `/member/billing` now matches `[orgSlug]`, so without this it reads as a
 * co-op called "billing" and shows "you're not a member of that". These are in
 * bookmarks, in old links and in the post-login redirect, so they are
 * forwarded rather than left to fail.
 */
const LEGACY_SECTIONS = new Set([
  'members', 'tiers', 'events', 'rooms', 'commons', 'expenses', 'settings',
  'bookings', 'billing', 'profile', 'rsvps',
]);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);

  const params = useParams();
  const urlSlug = typeof params?.orgSlug === 'string' ? params.orgSlug : undefined;

  // The sidebar is a permanent column from `lg` up and a drawer below it
  // (UI-01). It used to be permanent at every width: 256px of a 375px phone,
  // leaving 119px for the page.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [isLoading, token, router]);

  // Following a link inside the drawer would otherwise leave it open over the
  // page it just opened.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Everything downstream still asks the store for an org id — every API call
  // takes one — so the URL leads and the store follows.
  const urlOrgId = user?.orgs?.find((o) => o.org?.slug === urlSlug)?.orgId;
  useEffect(() => {
    if (urlOrgId && urlOrgId !== currentOrgId) {
      setCurrentOrg(urlOrgId);
    }
  }, [urlOrgId, currentOrgId, setCurrentOrg]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!token) {
    return null;
  }

  const hasOrg = user && user.orgs && user.orgs.length > 0;

  if (!hasOrg) {
    return <OrgSetup />;
  }

  // The co-op comes from the URL, not from what was last selected.
  //
  // `/admin` used to mean whichever org happened to be in localStorage, so the
  // same address meant different things to different people, two tabs could
  // not sit on two co-ops, and a stale id made every screen answer 403 with no
  // way out — every page that could change the selection was itself org-scoped
  // (AUTH-05). An address that names its co-op cannot do that: it is both the
  // source of truth and the thing you can edit.
  const fromUrl = urlSlug ? user.orgs.find((o) => o.org?.slug === urlSlug) : undefined;

  // A URL can now name a co-op you are not in — by typo, by a shared link, or
  // by leaving a co-op. Say so, rather than letting every request underneath
  // answer 403 with nothing explaining why.
  if (urlSlug && !fromUrl) {
    if (LEGACY_SECTIONS.has(urlSlug)) {
      return <LegacyPathRedirect section={urlSlug} />;
    }
    return <NotYourCoop slug={urlSlug} />;
  }

  const membership = fromUrl ?? user.orgs.find((o) => o.orgId === currentOrgId);

  /**
   * A co-op's colours on its members' own pages, and not on the admin (BRD-01).
   *
   * Charley asked for "all member pages". The organising tools are MaybeOS's,
   * not the co-op's — and an organiser who runs two co-ops needs the admin to
   * look like one product, not to change colour underneath them while they
   * work.
   */
  const isMemberArea = pathname?.startsWith('/member');
  const theme = isMemberArea ? brandTheme(membership?.org?.brandColor) : null;

  const role = membership?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';
  const orgSlug = membership?.org?.slug;
  const wantsAdmin = pathname?.startsWith('/admin');

  const breadcrumbSegments = pathname
    ? pathname.split('/').filter(Boolean)
    : [];
  // Falling back to the last path segment printed a raw UUID on any dynamic
  // route ("Admin / 1a54cbc0-e9e5-4a35-…"). Named routes win; an id never
  // reaches the header.
  const namedRoutes: [RegExp, string][] = [
    [/^\/admin\/events\/[^/]+$/, 'Check-in'],
    [/^\/member\/rsvps$/, 'My RSVPs'],
    [/^\/member\/events$/, 'My Events'],
    [/^\/member\/bookings$/, 'My Bookings'],
    [/^\/member\/billing$/, 'Billing'],
    [/^\/member\/profile$/, 'Profile'],
  ];
  const matched = namedRoutes.find(([pattern]) => pattern.test(pathname || ''))?.[1];
  const lastSegment = breadcrumbSegments[breadcrumbSegments.length - 1] ?? '';
  const looksLikeId = /^[0-9a-f-]{20,}$/i.test(lastSegment);
  const currentPage =
    breadcrumbMap[lastSegment] ||
    matched ||
    (looksLikeId ? 'Details' : lastSegment) ||
    'Dashboard';

  return (
    <div className="flex h-screen bg-gray-50" style={brandStyle(theme)}>
      {/* The permanent column, from `lg` up. */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </div>

      {/* The same column as a drawer below `lg`. The backdrop is a button so
          tapping outside closes it, which is what everybody tries first. */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <nav className="flex min-w-0 items-center gap-2 text-sm">
            {/* This said "Admin" on every member page too. It was also a bare
                span, so "My co-op" named a place a member had no way to go —
                the one crumb that should lead somewhere led nowhere. */}
            {!isOrganiser && orgSlug ? (
              <Link href={`/portal/${orgSlug}`} className="text-gray-400 hover:text-gray-900 transition-colors">
                {membership?.org?.name ?? 'My co-op'}
              </Link>
            ) : (
              <span className="text-gray-400">{isOrganiser ? 'Admin' : 'My co-op'}</span>
            )}
            {breadcrumbSegments.length > 1 && (
              <>
                <span className="text-gray-300">/</span>
                <span className="truncate font-medium text-gray-900">{currentPage}</span>
              </>
            )}
            {breadcrumbSegments.length <= 1 && (
              <>
                <span className="text-gray-300">/</span>
                <span className="font-medium text-gray-900">Dashboard</span>
              </>
            )}
          </nav>
          {/* The co-op's own mark, right-aligned, on its members' pages
              (BRD-01). Not on the admin: see `theme` above. */}
          {isMemberArea && (
            <span className="ml-auto flex items-center">
              <OrgMark name={membership?.org?.name} logoUrl={membership?.org?.logoUrl} />
            </span>
          )}

          {/* Was a div: it looked exactly like a button and did nothing when
              clicked, so the only way to search was a shortcut nobody had been
              told about. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600 [&:not(:first-child)]:ml-3"
          >
            <span>Search</span>
            {/* The shortcut is a desktop affordance and there is no room for
                it beside a breadcrumb on a phone. */}
            <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1 font-sans sm:inline">⌘K</kbd>
          </button>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="page-shell">
            {wantsAdmin && !isOrganiser ? <OrganiserOnly /> : children}
          </div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

/**
 * What a member sees if they reach an organiser page by URL (IMP-11).
 *
 * These pages used to render whatever the API said when it refused —
 * "Failed to load impact data: Insufficient role for this action" — which
 * reads as a broken product rather than a page that was never theirs. The
 * API is still the control; this is only what the refusal looks like.
 */
function LegacyPathRedirect({ section }: { section: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const area = pathname?.startsWith('/admin') ? 'admin' : 'member';
  const slug =
    (user?.orgs?.find((o) => o.orgId === currentOrgId) ?? user?.orgs?.[0])?.org?.slug;

  useEffect(() => {
    if (slug) router.replace(`/${area}/${slug}/${section}`);
  }, [slug, area, section, router]);

  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}

function NotYourCoop({ slug }: { slug: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Lock className="mx-auto h-10 w-10 text-gray-300" />
      <h1 className="mt-4 text-lg font-semibold text-gray-900">
        You&apos;re not a member of &ldquo;{slug}&rdquo;
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        This address belongs to a co-op you don&apos;t belong to. If you think you should,
        ask one of its organizers for an invitation.
      </p>
      <Link href="/member" className="btn-primary mt-6 inline-block text-sm">
        Go to your own co-op
      </Link>
    </div>
  );
}

function OrganiserOnly() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Lock className="mx-auto h-10 w-10 text-gray-300" />
      <h1 className="mt-4 text-lg font-semibold text-gray-900">
        This page is for organizers
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Your co-op&apos;s admins and staff manage this. If you think you should
        have access, ask one of them.
      </p>
      <Link href="/member" className="btn-secondary mt-6 inline-block text-sm">
        Back to my dashboard
      </Link>
    </div>
  );
}
