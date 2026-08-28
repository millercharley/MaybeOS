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
export function WelcomeCard({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [joins, setJoins] = useState<RecentJoins | null>(null);

  useEffect(() => {
    if (!orgId || !token) return;
    api.dashboard
      .recentJoins(orgId, token)
      .then(setJoins)
      .catch(() => setJoins(null));
  }, [orgId, token]);

  if (!joins || joins.members.length === 0) return null;

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
        <HandHeart className="h-4 w-4" />
        {joins.members.length === 1 ? 'Someone new is here' : 'Some new people are here'}
      </p>

      <ul className="mt-3 space-y-3">
        {joins.members.map((m) => (
          <li key={m.membershipId} className="flex items-center gap-3">
            {m.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-brand-700 ring-1 ring-brand-200">
                {(m.name ?? '?').charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{m.name ?? 'A new member'}</p>
              <p className="truncate text-xs text-gray-500">
                {/* Their own headline if they wrote one — it gives somebody
                    something to open with, which is the hard part. */}
                {m.headline ?? `joined ${timeAgo(m.joinedAt)}`}
              </p>
            </div>

            <Link
              href={`/portal/${orgSlug}/messages/${m.userId}`}
              className="btn-secondary shrink-0 text-xs"
            >
              Say hi
            </Link>
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
