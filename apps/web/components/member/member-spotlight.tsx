'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { api, SpotlightMember } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Panel } from '@/components/layout/panel';

/**
 * Somebody to meet, on the front of the dashboard (MEM-12).
 *
 * Charley: feature a member at random, a different one every visit, as a way
 * of introducing members to each other. The problem it is aimed at is a co-op
 * of forty people where everybody knows the same six.
 *
 * **Random on the server, once per load.** Not shuffled in the browser from a
 * list of everybody — that would ship the whole directory to render one card,
 * and would hand a member the rows the API is careful about.
 *
 * **A message is the whole point.** A card you can only look at introduces
 * nobody; the button is what turns "who is that" into a conversation, and it
 * goes straight to a thread with them rather than to their profile, because
 * the profile is one more click at which people stop.
 *
 * **It renders nothing rather than a placeholder.** A co-op of one, or one
 * where everybody else has hidden themselves from the directory, has nobody to
 * introduce — and a "no members to show" box on a dashboard is a small
 * indignity for a co-op that is just starting.
 */
export function MemberSpotlight({ orgSlug }: { orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [member, setMember] = useState<SpotlightMember | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) {
      setReady(true);
      return;
    }
    api.members
      .spotlight(orgId, token)
      .then((found) => {
        if (!cancelled) setMember(found);
      })
      .catch(() => {
        // An introduction is not worth an error message. If it cannot load,
        // the dashboard is simply the dashboard.
        if (!cancelled) setMember(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // Once per mount, which is once per visit — refetching on every render or
    // every navigation would swap the person out from under somebody who was
    // reading about them.
  }, [token, orgId]);

  if (!ready || !member) return null;

  const name = member.user.name?.trim() || 'A member';
  const initial = name.charAt(0).toUpperCase();
  const since = new Date(member.memberSince).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Panel title="Someone to meet">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100">
          {member.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-semibold text-brand-700">{initial}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{name}</p>
          {member.headline ? (
            <p className="mt-0.5 text-sm text-gray-600">{member.headline}</p>
          ) : member.bio ? null : (
            /* Only when there is genuinely nothing written. A member with a
               biography and no headline is already introduced by the paragraph
               below, and "you haven't met yet" underneath it reads as filler
               that did not notice the text next to it. */
            <p className="mt-0.5 text-sm text-gray-500">
              Member since {since}. You haven&apos;t met yet.
            </p>
          )}
          {member.location && (
            <p className="mt-0.5 text-xs text-gray-400">{member.location}</p>
          )}
        </div>
      </div>

      {member.bio && (
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-600">{member.bio}</p>
      )}

      {member.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {member.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      <Link
        href={`/portal/${orgSlug}/messages/${member.userId}`}
        className="btn-secondary mt-4 inline-flex items-center gap-2 text-sm"
      >
        <MessageSquare className="h-4 w-4" />
        Say hello
      </Link>
    </Panel>
  );
}
