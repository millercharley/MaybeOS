'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, PenSquare, Users } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { useUnread } from '@/contexts/unread-context';
import { api, type ThreadSummary } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';
import { renderBodyHtml } from '@/lib/rich-text';
import { PageHeader } from '@/components/layout/page-header';
import { NewMessage } from '@/components/messages/new-message';

/**
 * Conversations (CMN-08, CMN-16).
 *
 * This listed pairs, because the API held pairs. It lists threads now — a
 * one-to-one is a thread with two people in it — so a group conversation
 * appears here beside a DM with nothing to tell them apart but the names on
 * the row.
 */
export default function MessagesPage() {
  const { org } = usePortal();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const { refresh } = useUnread();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);

  const load = useCallback(() => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    api.commons
      .listThreads(org.id, token)
      .then(setThreads)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [org, token]);

  useEffect(load, [load]);

  if (!token) {
    return (
      <div className="py-12 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm text-gray-500">Sign in to read your messages.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        actions={
          !writing && (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="btn-primary inline-flex items-center gap-2 text-sm"
            >
              <PenSquare className="h-4 w-4" aria-hidden="true" />
              New message
            </button>
          )
        }
      />

      {writing && org && (
        <NewMessage
          orgId={org.id}
          onCancel={() => setWriting(false)}
          onSent={(thread) => {
            // Straight into the conversation that now exists — which may be
            // one these people already had, since choosing the same people
            // twice continues the thread rather than opening a second.
            setWriting(false);
            refresh();
            router.push(`/portal/${org.slug}/messages/t/${thread.id}`);
          }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            No conversations yet. Write to somebody with <b>New message</b>, or from anybody&rsquo;s
            card in the directory.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/portal/${org?.slug}/messages/t/${t.id}`}
              className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50"
            >
              <Faces thread={t} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-gray-900">
                  <span className="truncate">{t.name}</span>
                  {t.isGroup && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-gray-400"
                      title={`${t.participants.length} people`}
                    >
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {t.participants.length}
                    </span>
                  )}
                  {t.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-xs font-semibold text-white">
                      {t.unreadCount}
                    </span>
                  )}
                </p>
                {t.lastMessage ? (
                  <p
                    className="truncate text-sm text-gray-500 [&_p]:inline"
                    dangerouslySetInnerHTML={{ __html: renderBodyHtml(t.lastMessage.body) }}
                  />
                ) : (
                  <p className="truncate text-sm text-gray-400">No messages yet.</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-400">
                {timeAgo(t.lastMessage?.createdAt ?? t.lastMessageAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One face for a DM, two overlapped for a group.
 *
 * Enough to tell the two kinds apart at a glance without reading the names,
 * which is what a list is for.
 */
function Faces({ thread }: { thread: ThreadSummary }) {
  const others = thread.participants.slice(0, thread.isGroup ? 2 : 1);

  return (
    <div className="flex shrink-0 -space-x-3">
      {others.map((p) =>
        p.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.userId}
            src={p.avatarUrl}
            alt=""
            className="h-11 w-11 rounded-full object-cover ring-2 ring-white"
          />
        ) : (
          <div
            key={p.userId}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-2 ring-white"
          >
            {(p.name ?? '?').charAt(0).toUpperCase()}
          </div>
        ),
      )}
    </div>
  );
}
