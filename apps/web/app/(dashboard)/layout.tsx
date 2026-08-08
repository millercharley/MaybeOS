'use client';

import { useRouter, usePathname } from 'next/navigation';
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
  '/admin/impact': 'Impact',
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

  const breadcrumbSegments = pathname
    ? pathname.split('/').filter(Boolean)
    : [];
  const currentPage = breadcrumbMap[pathname || ''] || breadcrumbSegments[breadcrumbSegments.length - 1] || 'Dashboard';

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="fixed inset-y-0 left-0 w-64 z-30">
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-gray-200 bg-white px-8">
          <nav className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Admin</span>
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
          <div className="p-8">{children}</div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
