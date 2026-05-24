'use client';

import { useParams } from 'next/navigation';
import { PortalProvider, usePortal } from '@/contexts/portal-context';
import { PortalNav } from '@/components/portal/portal-nav';

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
          The organization you're looking for doesn't exist or the URL is incorrect.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PortalNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-gray-200 bg-white py-6 text-center text-sm text-gray-400">
        Powered by MaybeOS
      </footer>
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
