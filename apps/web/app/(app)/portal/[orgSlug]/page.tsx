import { redirect } from 'next/navigation';

/**
 * The portal home is My Dashboard now (NAV-04).
 *
 * Charley: "I don't think we need this page because it's redundant with My
 * Dashboard." It was. The co-op's mission is on the public org page, the
 * Explore grid repeated four items that are in the sidebar on every screen,
 * and the next three events are on the dashboard already as "Today at …". The
 * page had one in-app link to it — the co-op's name in the breadcrumb — and
 * sign-in has not sent anybody here since 2026-10-02.
 *
 * A redirect rather than a deletion. This address is on the public org page as
 * "Enter Member Portal", it is what a tenant subdomain's root rewrites to, and
 * it is in bookmarks. The two things that lived *only* here — who is in the
 * building, and who just joined — moved to the dashboard with it, so the
 * redundancy is now real rather than asserted.
 *
 * Server-side, so nobody watches a portal shell paint and then leave.
 */
export default async function PortalHomePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/member/${orgSlug}`);
}
