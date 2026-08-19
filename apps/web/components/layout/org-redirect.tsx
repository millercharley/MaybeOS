'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Send a bare `/admin` or `/member` to an address that names the co-op.
 *
 * Every link written before the slug moved into the path lands here, as do
 * bookmarks and the post-login redirect. Rewriting them all and deleting these
 * would break paths people already hold — the failure this session has spent
 * most of its time removing.
 *
 * Prefers the co-op already selected, so following an old link does not
 * silently move somebody to a different co-op than the one they were in.
 */
export function OrgRedirect({ area }: { area: 'admin' | 'member' }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);

  const membership =
    user?.orgs?.find((o) => o.orgId === currentOrgId) ?? user?.orgs?.[0];
  const slug = membership?.org?.slug;

  useEffect(() => {
    if (isLoading || !user) return;
    if (slug) router.replace(`/${area}/${slug}`);
  }, [isLoading, user, slug, area, router]);

  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}
