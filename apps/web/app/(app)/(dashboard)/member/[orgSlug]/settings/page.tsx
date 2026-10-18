'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { scrollToHashWhenReady } from '@/lib/scroll-to-hash';
import { DoorCode } from '@/components/member/door-code';
import { ChangePassword } from '@/components/member/change-password';
import { EmailPreferences } from '@/components/member/email-preferences';
import { MyInterests } from '@/components/member/my-interests';
import { DemographicProfile } from '@/components/member/demographic-profile';
import { BuddySettings } from '@/components/belonging/buddy-settings';
import { ForumMembership } from '@/components/member/forum-membership';

/**
 * A member's own settings (UI-03).
 *
 * Split out of My Profile, which had grown into two pages wearing one name:
 * the top of it was how a member appears to everybody else, and the bottom
 * was a column of switches nobody else will ever see. Charley: "keep the
 * Profile page as the place for things that the member manages in terms of
 * their identity within the community."
 *
 * So the division is by audience, not by subject. If changing it changes what
 * another member sees, it is on My Profile. If it changes only what happens
 * to this member — their password, their email, what they told the co-op in
 * confidence — it is here.
 *
 * The door code is on both, because it is the one thing on either page a
 * member needs while standing at a door, and guessing which page it was on is
 * the opposite of useful (DOR-01).
 */
export default function MySettingsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router]);

  /*
    Land on the card the link named (UI-03).

    Every card here fetches before it renders, so the browser's own jump to
    `#interests` finds nothing and gives up — and a member following a link
    from a Radar digest arrives at their password form instead. Looking again
    for a few seconds is the difference between the right page and the right
    place on it.
  */
  useEffect(() => scrollToHashWhenReady(window.location.hash), []);

  if (!token) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Settings"
        description="Your password, what we email you, and what you have told your co-op."
        actions={<DoorCode />}
      />

      <ChangePassword />

      {/* Everything MaybeOS might send, in one card rather than five. */}
      <EmailPreferences />

      {/* What Radar matches on, including what it inferred (RDR-01). Emails
          already sent link to `#interests`, which is why My Profile forwards
          that hash here rather than leaving it pointing at nothing. */}
      <MyInterests />

      <DemographicProfile />

      {/* Renders nothing unless this co-op runs the Buddy System and this
          member has some history with it (BEL). */}
      {orgId && orgSlug && <BuddySettings orgId={orgId} orgSlug={orgSlug} />}

      {/* Renders nothing on a deployment with no forum (FRM-01). */}
      <ForumMembership />
    </div>
  );
}
