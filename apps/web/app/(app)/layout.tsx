'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette, OPEN_SEARCH_EVENT } from '@/components/layout/command-palette';
import { OrgMark } from '@/components/layout/org-mark';
import { PortalProvider, usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { brandStyle, brandTheme } from '@/lib/brand';

/**
 * The shell every signed-in screen shares: one sidebar, one header (NAV-03).
 *
 * Charley, 2026-09-04: "the navigation panel and the header never reload when
 * a user moves to a different page." They did, and the reason was structural
 * rather than a bug anybody wrote — `(dashboard)` and `portal` were sibling
 * route groups, each rendering its own `<Sidebar>`. Next keeps a layout
 * mounted while you move *within* it and throws it away when you leave, so
 * `/admin/x` → `/member/x` was seamless and `/admin/x` → `/portal/x` tore the
 * whole column down and built a new one: the collapse state reset, the scroll
 * jumped to the top, and the getting-started checklist and the links section
 * blinked out and refetched.
 *
 * Measured before the change: navigating inside the dashboard, the `<aside>`
 * was the same DOM node; crossing into the portal, it was not.
 *
 * So both areas now live under this one layout, which owns the chrome and
 * nothing else. What each area still owns is its *guard* — they are genuinely
 * different rules, and that is why this could not simply be one merged
 * component:
 *
 *   - the dashboard requires a session and membership of the co-op in the URL
 *   - the portal requires a session for most of itself, and deliberately not
 *     for a shared event link or a published report (AUTH-08)
 *
 * Both guards moved *below* this layout so that a refusal renders inside the
 * shell rather than replacing it. Being told "this page is for organizers" is
 * a page, not a different application, and the nav should still be there to
 * leave by.
 *
 * `PortalProvider` is rendered unconditionally, with `orgSlug` undefined off
 * the portal. That is the load-bearing detail: wrapping it conditionally would
 * change the tree's shape between routes and unmount everything underneath —
 * which is the bug this file exists to fix, reintroduced one level down.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const slugParam = typeof params?.orgSlug === 'string' ? params.orgSlug : undefined;
  const onPortal = pathname?.startsWith('/portal') ?? false;

  return (
    <PortalProvider orgSlug={onPortal ? slugParam : undefined}>
      <AppShell>{children}</AppShell>
    </PortalProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const signedIn = Boolean(token && user);

  const { org: portalOrg } = usePortal();

  // The drawer, below `lg`. Closed on every navigation, or following a link
  // inside it would leave it open over the page it just opened.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const onPortal = pathname?.startsWith('/portal') ?? false;
  const onMember = pathname?.startsWith('/member') ?? false;

  const urlSlug = typeof params?.orgSlug === 'string' ? params.orgSlug : undefined;
  const membership =
    user?.orgs?.find((o) => o.org?.slug === urlSlug) ??
    user?.orgs?.find((o) => o.orgId === currentOrgId);
  const role = membership?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';

  /**
   * Whose colours, and whether to use them (BRD-01).
   *
   * The portal is always the co-op's, and it may be a co-op the viewer is not
   * in — so it takes the org the URL named. A member's own pages take the
   * co-op they belong to. The admin takes neither: the organising tools are
   * MaybeOS's, and an organiser running two co-ops needs them to look like one
   * product rather than change colour underneath them.
   */
  const brandedOrg = onPortal
    ? { name: portalOrg?.name, brandColor: portalOrg?.brandColor, logoUrl: portalOrg?.logoUrl }
    : onMember
      ? {
          name: membership?.org?.name,
          brandColor: membership?.org?.brandColor,
          logoUrl: membership?.org?.logoUrl,
        }
      : null;
  const theme = brandTheme(brandedOrg?.brandColor);

  return (
    <div className="flex h-screen bg-gray-50" style={brandStyle(theme)}>
      {/* The permanent column, from `lg` up. Rendered once, here, for every
          screen in the product — which is the whole point of this file. */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar
          orgSlug={onPortal ? urlSlug : undefined}
          orgName={onPortal ? portalOrg?.name : undefined}
        />
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
            <Sidebar
              orgSlug={onPortal ? urlSlug : undefined}
              orgName={onPortal ? portalOrg?.name : undefined}
            />
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

          <Breadcrumb
            pathname={pathname}
            onPortal={onPortal}
            isOrganiser={isOrganiser}
            coopName={onPortal ? portalOrg?.name : membership?.org?.name}
            coopSlug={onPortal ? urlSlug : membership?.org?.slug}
          />

          {/* The co-op's own mark, wherever its colours are (BRD-01). */}
          {brandedOrg?.logoUrl && (
            <span className="ml-auto flex items-center">
              <OrgMark name={brandedOrg.name} logoUrl={brandedOrg.logoUrl} />
            </span>
          )}

          {/* Search is org-scoped and needs a session; a signed-out visitor on
              a public event page has nothing for it to search. */}
          {signedIn && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600 [&:not(:first-child)]:ml-3"
            >
              <span>Search</span>
              {/* A desktop affordance; there is no room for it beside a
                  breadcrumb on a phone. */}
              <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1 font-sans sm:inline">
                ⌘K
              </kbd>
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto">
          <div className="page-shell">{children}</div>
        </main>
      </div>

      {signedIn && <CommandPalette />}
    </div>
  );
}

/**
 * Where you are, in two crumbs.
 *
 * Derived entirely from the address, so it costs nothing and cannot disagree
 * with the page. It used to say "Admin" on every member page, and "My co-op"
 * used to be a bare span — the one crumb that should lead somewhere led
 * nowhere.
 */
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
  handbook: 'Handbook',
  directory: 'Directory',
  messages: 'Messages',
  serve: 'Serve',
  serving: 'Serving',
  payouts: 'Host payouts',
  belonging: 'Belonging',
  impact: 'Measuring',
  rsvps: 'My RSVPs',
  service: 'My Service',
};

function Breadcrumb({
  pathname, onPortal, isOrganiser, coopName, coopSlug,
}: {
  pathname: string | null;
  onPortal: boolean;
  isOrganiser: boolean;
  coopName?: string;
  coopSlug?: string;
}) {
  const segments = (pathname ?? '').split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const looksLikeId = /^[0-9a-f-]{20,}$/i.test(last);
  const current =
    breadcrumbMap[last] || (looksLikeId ? 'Details' : last) || 'Dashboard';

  // On the portal and on a member's pages the first crumb is the co-op and
  // leads to it. On the admin it is the word "Admin", which is a place rather
  // than a co-op and has nowhere of its own to go.
  const root =
    onPortal || !isOrganiser ? (
      coopSlug ? (
        <Link href={`/portal/${coopSlug}`} className="text-gray-400 transition-colors hover:text-gray-900">
          {coopName ?? 'My co-op'}
        </Link>
      ) : (
        <span className="text-gray-400">{coopName ?? 'My co-op'}</span>
      )
    ) : (
      <span className="text-gray-400">Admin</span>
    );

  return (
    <nav className="flex min-w-0 items-center gap-2 text-sm">
      {root}
      <span className="text-gray-300">/</span>
      <span className="truncate font-medium text-gray-900">
        {segments.length > 2 ? current : 'Dashboard'}
      </span>
    </nav>
  );
}
