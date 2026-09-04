import { redirect } from 'next/navigation';

/**
 * `/welcome` is now `/handbook` (CMN-11).
 *
 * Kept as a redirect rather than deleted, because this address is in places
 * nobody can edit: invitation and required-reading emails already sent, and
 * whatever members have bookmarked. A co-op's own handbook 404ing for the
 * people who were told to read it is the one failure this rename must not
 * cause.
 */
export default async function WelcomeRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/portal/${orgSlug}/handbook`);
}
