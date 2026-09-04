'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { portalRequiresAuth } from '@/lib/portal-access';
import { RequiredReadingBanner } from '@/components/belonging/required-reading-banner';

/**
 * Who may be inside a co-op's portal — and nothing else (NAV-03).
 *
 * The chrome moved up to `(app)/layout.tsx`, which also owns the
 * `PortalProvider` this reads from: one provider for the whole app means the
 * shell can brand a portal page without a second fetch, and means moving
 * between the portal and the admin does not tear the sidebar down.
 *
 * What stays here is the rule, which is not the dashboard's rule.
 *
 * The portal was built with no session check at all — the co-op is fetched by
 * slug without a token, so the shell rendered for anybody, and signing out
 * left you on `/portal/maybeitsfate/rooms` with the co-op's name in the
 * sidebar while every request underneath answered 401 (AUTH-08). But it is not
 * uniformly private either: a shared event link and a published impact report
 * exist to be opened by people who are not members. `portalRequiresAuth` holds
 * that boundary as an allowlist.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { org, orgSlug, loading, error } = usePortal();
  const pathname = usePathname();
  const router = useRouter();

  const token = useAuthStore((s) => s.token);
  const authLoading = useAuthStore((s) => s.isLoading);
  const signedOut = !authLoading && !token && portalRequiresAuth(pathname);

  useEffect(() => {
    if (!signedOut) return;
    const target = pathname ?? `/portal/${orgSlug}`;
    router.replace(`/login?redirect=${encodeURIComponent(target)}`);
  }, [signedOut, pathname, orgSlug, router]);

  // Nothing of the co-op is drawn before the session is known, and nothing at
  // all once it is known to be absent — otherwise the page flashes on screen
  // for the length of a redirect.
  if (loading || authLoading || signedOut) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Organization Not Found</h1>
        <p className="mt-2 text-gray-500">
          The organization you&apos;re looking for doesn&apos;t exist or the URL is incorrect.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Above the content on every portal page (BEL, §6.2): a member needs to
          know what they owe *before* they write a paragraph into a composer and
          get refused, which is the version of this that makes people feel
          tricked. */}
      <RequiredReadingBanner />
      {children}
    </>
  );
}
