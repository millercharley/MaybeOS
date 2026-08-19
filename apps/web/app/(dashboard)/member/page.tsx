'use client';

import { OrgRedirect } from '@/components/layout/org-redirect';

/** `/member` with no co-op named. See the admin equivalent. */
export default function MemberIndexPage() {
  return <OrgRedirect area="member" />;
}
