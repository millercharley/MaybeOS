'use client';

import { useParams } from 'next/navigation';
import { PortalProvider, usePortal } from '@/contexts/portal-context';
import { PortalNav } from '@/components/portal/portal-nav';
import { Sidebar } from '@/components/layout/sidebar';
import { RequiredReadingBanner } from '@/components/belonging/required-reading-banner';

function PortalShell({ children }: { children: React.ReactNode }) {
  const { org, orgSlug, loading, error } = usePortal();

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
      {/* The same column as every other screen (Charley, 2026-08-19). It is
          given this page's co-op explicitly, because the portal can be showing
          a co-op the viewer has not selected — or is not a member of at all. */}
      <div className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar orgSlug={orgSlug} orgName={org?.name} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Still the navigation below `lg`, where a permanent column does not
            fit. Above it the sidebar carries everything and this would be a
            second copy of the same links. */}
        <div className="lg:hidden">
          <PortalNav />
        </div>

        {/* Left-aligned and uncapped, matching the dashboard's `p-8` exactly
            (Charley, 2026-08-19). It was centred inside a max-width, so the
            portal's content sat in the middle of the screen while the admin and
            membership pages beside it started at the left edge — the same app
            appearing to use two different grids depending which page you were
            on. Consistency here beats the capped measure I reached for: the
            portal's own pages already constrain their long text. */}
        {/* Above the content on every portal page (BEL, §6.2): a member
            needs to know what they owe *before* they write a paragraph into a
            composer and get refused, which is the version of this that makes
            people feel tricked. */}
        <RequiredReadingBanner />

        <main className="flex-1 overflow-auto">
          <div className="p-8">{children}</div>
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
