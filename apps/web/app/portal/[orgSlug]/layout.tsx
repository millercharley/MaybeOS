'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { PortalProvider, usePortal } from '@/contexts/portal-context';
import { Sidebar } from '@/components/layout/sidebar';
import { RequiredReadingBanner } from '@/components/belonging/required-reading-banner';

function PortalShell({ children }: { children: React.ReactNode }) {
  const { org, orgSlug, loading, error } = usePortal();
  const pathname = usePathname();

  // The same drawer as the dashboard (UI-01). The portal used to show a
  // second, horizontal navigation below `lg` — a different set of links in a
  // different shape for the same co-op, which is the inconsistency the one
  // shared sidebar was introduced to end.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 w-64">
            <Sidebar orgSlug={orgSlug} orgName={org?.name} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* A bar that exists only to reach the drawer. Above `lg` the sidebar
            is permanent and this would be a header over nothing. */}
        <div className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-gray-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate font-medium text-gray-900">{org?.name}</span>
        </div>

        {/* Above the content on every portal page (BEL, §6.2): a member
            needs to know what they owe *before* they write a paragraph into a
            composer and get refused, which is the version of this that makes
            people feel tricked. */}
        <RequiredReadingBanner />

        {/* Centred and capped, like every other screen (UI-01). This was
            deliberately left-aligned and uncapped in August to match the
            dashboard; Charley reversed that on 2026-09-03 — "this doesn't look
            right on big screens" — and the dashboard moved with it, so the two
            still agree. That was the point of the original decision and it
            survives the reversal. */}
        <main className="flex-1 overflow-auto">
          <div className="page-shell">{children}</div>
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
