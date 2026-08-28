'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, DmConversation } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';
import { renderBodyHtml } from '@/lib/rich-text';

/**
 * Conversations (CMN-08).
 *
 * The API has had direct messages since CMN-07 and nothing rendered them, so
 * every message ever sent was invisible and the buddy introductions BEL-02
 * writes had nowhere to send anybody. This is that screen.
 */
export default function MessagesPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    api.commons
      .listConversations(org.id, token)
      .then(setConversations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [org, token]);

  if (!token) {
    return (
      <div className="py-12 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm text-gray-500">Sign in to read your messages.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Messages</h1>

      {conversations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            No conversations yet. You can start one from anybody&rsquo;s card in the directory.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {conversations.map((c) => (
            <Link
              key={c.counterpart.id}
              href={`/portal/${org?.slug}/messages/${c.counterpart.id}`}
              className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50"
            >
              {c.counterpart.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.counterpart.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                  {(c.counterpart.name ?? '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-gray-900">
                  {c.counterpart.name ?? 'A member'}
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </p>
                <p
                  className="truncate text-sm text-gray-500 [&_p]:inline"
                  dangerouslySetInnerHTML={{ __html: renderBodyHtml(c.lastMessage.body) }}
                />
              </div>
              <span className="shrink-0 text-xs text-gray-400">{timeAgo(c.lastMessage.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
