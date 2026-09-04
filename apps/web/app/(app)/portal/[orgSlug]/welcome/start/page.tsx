import { redirect } from 'next/navigation';

/** The reading flow moved with the section it belongs to (CMN-11). */
export default async function WelcomeStartRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/portal/${orgSlug}/handbook/start`);
}
