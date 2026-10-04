'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

/**
 * "Message this person", resolved to the conversation they are in (CMN-16).
 *
 * Eight places in the product link here by a member's user id — the directory,
 * a member card, an event's host and co-hosts, both buddy pages, the member
 * spotlight, the welcome card. They were written when a conversation *was* a
 * pair, and they all still work: this finds the one-to-one thread with that
 * person, creating it if it does not exist, and hands over to the thread page.
 *
 * `replace`, not `push`: the resolved address is where this conversation
 * lives, and Back should return to the directory rather than to a redirect
 * that immediately runs again.
 *
 * Nothing is sent by arriving here. The thread is created empty — opening
 * somebody's profile and pressing Message must not message them.
 */
export default function MessageMemberPage() {
  const { org } = usePortal();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const { orgSlug, userId } = useParams<{ orgSlug: string; userId: string }>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!org || !token) return;
    let live = true;

    api.commons
      .threadWithUser(org.id, userId, token)
      .then((thread) => {
        if (live) router.replace(`/portal/${orgSlug}/messages/t/${thread.id}`);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not open that conversation');
      });

    return () => {
      live = false;
    };
  }, [org, token, userId, orgSlug, router]);

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-600">{error}</p>
        <Link
          href={`/portal/${orgSlug}/messages`}
          className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Back to Messages
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}
