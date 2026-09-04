'use client';

import Link from 'next/link';
import { useRouter, usePathname, useParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { OrgSetup } from '@/components/setup/org-setup';

/**
 * Who may be in `/admin` and `/member` — and nothing else (NAV-03).
 *
 * This file used to be the whole shell as well as the guard. The chrome moved
 * up to `(app)/layout.tsx` so that one sidebar and one header survive every
 * navigation in the product; what is left here is the rule, which is genuinely
 * this area's own and not the portal's.
 *
 * Everything it refuses now renders *inside* the shell rather than replacing
 * it. Being told a page is for organizers is a page, not a different
 * application — the nav should still be there to leave by.
 */

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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);

  const params = useParams();
  const urlSlug = typeof params?.orgSlug === 'string' ? params.orgSlug : undefined;

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [isLoading, token, router]);

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
      <div className="flex items-center justify-center py-20">
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
  // way out (AUTH-05). An address that names its co-op cannot do that: it is
  // both the source of truth and the thing you can edit.
  const fromUrl = urlSlug ? user.orgs.find((o) => o.org?.slug === urlSlug) : undefined;

  // A URL can name a co-op you are not in — by typo, by a shared link, or by
  // leaving a co-op. Say so, rather than letting every request underneath
  // answer 403 with nothing explaining why.
  if (urlSlug && !fromUrl) {
    if (LEGACY_SECTIONS.has(urlSlug)) {
      return <LegacyPathRedirect section={urlSlug} />;
    }
    return <NotYourCoop slug={urlSlug} />;
  }

  const membership = fromUrl ?? user.orgs.find((o) => o.orgId === currentOrgId);
  const role = membership?.role;
  const isOrganiser = role === 'ADMIN' || role === 'STAFF';
  const wantsAdmin = pathname?.startsWith('/admin');

  return <>{wantsAdmin && !isOrganiser ? <OrganiserOnly /> : children}</>;
}

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

/**
 * What a member sees if they reach an organizer page by URL (IMP-11).
 *
 * These pages used to render whatever the API said when it refused —
 * "Failed to load impact data: Insufficient role for this action" — which
 * reads as a broken product rather than a page that was never theirs. The API
 * is still the control; this is only what the refusal looks like.
 */
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
