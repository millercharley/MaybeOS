'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HandHeart } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import type { RecentJoins } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';

/**
 * "Somebody new is here" (delight #4).
 *
 * The whole point is the one tap. A card that says a member joined and leaves
 * you to find them in the directory is a card nobody acts on — so the button
 * goes straight to the message box, which is the same success action the
 * Buddy System is built around.
 *
 * **Derived from join dates, never posted.** A real post in the channel would
 * sit there forever, push conversation down, and need a moderation decision
 * to remove. This appears when somebody joins and is gone a week later,
 * leaving nothing behind.
 *
 * Renders nothing when nobody has joined — which is most weeks, for most
 * co-ops, and a permanent empty "new members" card is a weekly reminder that
 * nobody is joining.
 */

/**
 * Who has joined this week.
 *
 * Shared, because two surfaces show the same arrivals differently: the
 * dashboard groups them into one card, and the Commons places each one in the
 * conversation at the moment they joined (CMN-11). Fetching it twice would be
 * two requests for one answer, and two chances for them to disagree.
 */
export function useRecentJoins(orgId: string): RecentJoins | null {
  const token = useAuthStore((s) => s.token);
  const [joins, setJoins] = useState<RecentJoins | null>(null);

  useEffect(() => {
    if (!orgId || !token) return;
    api.dashboard
      .recentJoins(orgId, token)
      .then(setJoins)
      .catch(() => setJoins(null));
  }, [orgId, token]);

  return joins;
}

/** One arrival, with their avatar, their headline and the one tap. */
function Arrival({
  member,
  orgSlug,
}: {
  member: RecentJoins['members'][number];
  orgSlug: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-700 ring-1 ring-brand-200">
          {(member.name ?? '?').charAt(0).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900">{member.name ?? 'A new member'}</p>
        <p className="truncate text-xs text-gray-500">
          {/* Their own headline if they wrote one — it gives somebody
              something to open with, which is the hard part. */}
          {member.headline ?? `joined ${timeAgo(member.joinedAt)}`}
        </p>
      </div>

      <Link
        href={`/portal/${orgSlug}/messages/${member.userId}`}
        className="btn-secondary shrink-0 text-xs"
      >
        Say hi
      </Link>
    </div>
  );
}

/**
 * One arrival, in the conversation, at the moment they arrived (CMN-11).
 *
 * The same card as the dashboard's, for one person, so it can take its place
 * in the channel's vertical order instead of floating above it. A card that
 * sits above an August message for somebody who joined in September reads as
 * a claim about when they joined, and the claim is wrong.
 */
export function WelcomeNote({
  member,
  orgSlug,
  more = 0,
}: {
  member: RecentJoins['members'][number];
  orgSlug: string;
  more?: number;
}) {
  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
        <HandHeart className="h-4 w-4" />
        Someone new is here
      </p>

      <div className="mt-3">
        <Arrival member={member} orgSlug={orgSlug} />
      </div>

      {more > 0 && (
        <p className="mt-3 text-xs text-brand-800">
          and {more} {more === 1 ? 'other' : 'others'} this week —{' '}
          <Link href={`/portal/${orgSlug}/directory`} className="underline">
            see the directory
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * Everyone who joined this week, grouped, for the member dashboard.
 *
 * The Commons uses `WelcomeNote` instead, one per arrival, so each can sit at
 * its own place in the conversation. A dashboard has no conversation to sit
 * in, so here they read better as one card.
 */
export function WelcomeCard({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const joins = useRecentJoins(orgId);

  if (!joins || joins.members.length === 0) return null;

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
        <HandHeart className="h-4 w-4" />
        {joins.members.length === 1 ? 'Someone new is here' : 'Some new people are here'}
      </p>

      <ul className="mt-3 space-y-3">
        {joins.members.map((m) => (
          <li key={m.membershipId}>
            <Arrival member={m} orgSlug={orgSlug} />
          </li>
        ))}
      </ul>

      {joins.more > 0 && (
        <p className="mt-3 text-xs text-brand-800">
          and {joins.more} {joins.more === 1 ? 'other' : 'others'} this week —{' '}
          <Link href={`/portal/${orgSlug}/directory`} className="underline">
            see the directory
          </Link>
        </p>
      )}
    </div>
  );
}
