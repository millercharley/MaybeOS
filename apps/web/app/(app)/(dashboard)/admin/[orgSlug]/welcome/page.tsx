import { redirect } from 'next/navigation';

/** "Welcoming" is now "Handbook" (CMN-11). Bookmarks still work. */
export default async function AdminWelcomeRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/admin/${orgSlug}/handbook`);
}
