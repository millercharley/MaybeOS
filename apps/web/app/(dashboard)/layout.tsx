'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette } from '@/components/layout/command-palette';
import { useAuthStore } from '@/lib/auth-store';
import { OrgSetup } from '@/components/setup/org-setup';

const breadcrumbMap: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/members': 'Members',
  '/admin/events': 'Events',
  '/admin/rooms': 'Rooms & Booking',
  '/admin/commons': 'Commons',
  '/admin/settings': 'Settings',
};

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

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [isLoading, token, router]);

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

  const hasOrg = user && user.orgs && user.orgs.length > 0 && currentOrgId;

  if (!hasOrg) {
    return <OrgSetup />;
  }

  const role = user.orgs.find((o) => o.orgId === currentOrgId)?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';
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
    [/^\/member\/bookings$/, 'My Bookings'],
    [/^\/member\/billing$/, 'Billing'],
    [/^\/member\/profile$/, 'Profile'],
  ];
  const matched = namedRoutes.find(([pattern]) => pattern.test(pathname || ''))?.[1];
  const lastSegment = breadcrumbSegments[breadcrumbSegments.length - 1] ?? '';
  const looksLikeId = /^[0-9a-f-]{20,}$/i.test(lastSegment);
  const currentPage =
    breadcrumbMap[pathname || ''] ||
    matched ||
    (looksLikeId ? 'Details' : lastSegment) ||
    'Dashboard';

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="fixed inset-y-0 left-0 w-64 z-30">
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-gray-200 bg-white px-8">
          <nav className="flex items-center gap-2 text-sm">
            {/* This said "Admin" on every member page too. */}
            <span className="text-gray-400">{isOrganiser ? 'Admin' : 'My co-op'}</span>
            {breadcrumbSegments.length > 1 && (
              <>
                <span className="text-gray-300">/</span>
                <span className="font-medium text-gray-900">{currentPage}</span>
              </>
            )}
            {breadcrumbSegments.length <= 1 && (
              <>
                <span className="text-gray-300">/</span>
                <span className="font-medium text-gray-900">Dashboard</span>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-400">
            <span>Search</span>
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 font-sans">⌘K</kbd>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-8">
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
function OrganiserOnly() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Lock className="mx-auto h-10 w-10 text-gray-300" />
      <h1 className="mt-4 text-lg font-semibold text-gray-900">
        This page is for organisers
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
