'use client';

import { OrgRedirect } from '@/components/layout/org-redirect';

/**
 * `/admin` with no co-op named.
 *
 * The address used to mean whichever org was in localStorage. It now sends you
 * to one that says which — kept rather than deleted because this path is in
 * bookmarks, in the login redirect, and in every link written before today.
 */
export default function AdminIndexPage() {
  return <OrgRedirect area="admin" />;
}
