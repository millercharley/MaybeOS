'use client';

import { useParams } from 'next/navigation';
import { PortalProvider, usePortal } from '@/contexts/portal-context';
import { PortalNav } from '@/components/portal/portal-nav';
import { PortalSidebar } from '@/components/portal/portal-sidebar';

function PortalShell({ children }: { children: React.ReactNode }) {
  const { org, loading, error } = usePortal();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-900">Organization Not Found</h1>
        <p className="mt-2 text-gray-500">
          The organization you&apos;re looking for doesn&apos;t exist or the URL is incorrect.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <PortalSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Still the navigation below `lg`, where a permanent column does not
            fit. Above it the sidebar carries everything and this would be a
            second copy of the same links. */}
        <div className="lg:hidden">
          <PortalNav />
        </div>

        {/* Was `max-w-5xl` centred, which on a large monitor left a narrow
            strip of content under a full-width bar with everything crowded
            into the middle. With the column beside it the page can use the
            width it has, and still stops short of the line lengths that make
            long text unreadable. */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>

        <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
          Powered by MaybeOS
        </footer>
      </div>
    </div>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return (
    <PortalProvider orgSlug={orgSlug}>
      <PortalShell>{children}</PortalShell>
    </PortalProvider>
  );
}
