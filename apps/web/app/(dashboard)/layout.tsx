'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';

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
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
