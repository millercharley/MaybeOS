'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lightbulb, Users, X } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, type ThreadDetail } from '@/lib/api';
import { renderBodyHtml } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { timeAgo } from '@/lib/relative-time';
import { useUnread } from '@/contexts/unread-context';

/**
 * One conversation — two people or twenty (CMN-08, CMN-16, PRD §5.4).
 *
 * This is also where the whole Buddy System lands. Both introduction emails
 * point here, and §5.3 is explicit that **sending the first message is the
 * success action** — so the composer is the first thing in reach and the
 * suggestions sit directly above it, where somebody stuck for an opening line
 * is already looking.
 *
 * A suggestion **fills the composer and stops**. Nothing sends on a tap. A
 * welcome that a co-op wrote and a member merely transmitted is not a welcome,
 * and the edit somebody makes on the way to sending it is the part that makes
 * it theirs.
 *
 * Group threads show who said what; a one-to-one does not, because in a
 * conversation between two people the side of the screen already says it.
 */
export default function ThreadPage() {
  const { org } = usePortal();
  const { settle } = useUnread();
  const token = useAuthStore((s) => s.token);
  const me = useAuthStore((s) => s.user);
  const threadId = useParams<{ threadId: string }>().threadId;

  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; body: string }>>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    try {
      const detail = await api.commons.getThread(org.id, threadId, token);
      setThread(detail);

      /*
        Suggestions are a buddy thing, and a buddy is one person. They are
        asked for only on a one-to-one, and the API returns nothing to anyone
        who is not the buddy — so this cannot be revealed by poking at a URL.
      */
      const other = detail.participants.find((p) => p.userId !== me?.id);
      if (!detail.isGroup && other) {
        const prompts = await api.belonging
          .threadSuggestions(org.id, other.userId, token)
          .catch(() => ({ suggestions: [] }));
        setSuggestions(prompts.suggestions);
      } else {
        setSuggestions([]);
      }

      // The badge is drawn from shared state, not from this page, so opening
      // a conversation has to say so (CMN-14).
      const totals = await api.commons.markThreadRead(org.id, threadId, token).catch(() => null);
      if (totals) settle(totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this conversation');
    } finally {
      setLoading(false);
    }
  }, [org, token, threadId, settle, me?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const messages = thread?.messages ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/portal/${org?.slug}/messages`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Messages
      </Link>

      <div>
        <h1 className="font-display text-2xl leading-tight text-ink">
          {thread?.name ?? 'Conversation'}
        </h1>
        {thread?.isGroup && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-gray-500">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {thread.participants.length} people — everybody here sees every reply
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            Nothing here yet. Whatever you write first is fine.
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === me?.id;
          // Only when it changes hands, and only in a group: a name over every
          // bubble in a run by the same person is noise.
          const showName =
            thread?.isGroup && !mine && messages[i - 1]?.senderId !== m.senderId;

          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                {showName && (
                  <p className="mb-0.5 pl-1 text-xs font-medium text-gray-500">
                    {m.sender?.name ?? 'A member'}
                  </p>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 ${
                    mine ? 'bg-brand-600 text-white' : 'bg-white text-gray-800 ring-1 ring-gray-200'
                  }`}
                >
                  <div
                    className="rich-body text-sm [&>*+*]:mt-2"
                    dangerouslySetInnerHTML={{ __html: renderBodyHtml(m.body) }}
                  />
                  <p className={`mt-1 text-[11px] ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                    {timeAgo(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
            <Lightbulb className="h-3.5 w-3.5" />
            Some things that tend to help. Tap one to put it in the box — nothing sends until you do.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white pl-3 text-sm text-gray-800"
              >
                <button
                  onClick={() => setDraft((d) => (d ? `${d}<p>${s.body}</p>` : `<p>${s.body}</p>`))}
                  className="py-1.5 text-left hover:text-brand-700"
                >
                  {s.body}
                </button>
                <button
                  onClick={async () => {
                    if (!org || !token) return;
                    setSuggestions((all) => all.filter((x) => x.id !== s.id));
                    await api.belonging.dismissSuggestion(org.id, s.id, token).catch(() => {});
                  }}
                  aria-label={`Hide "${s.body}"`}
                  className="rounded-full p-1.5 text-gray-400 hover:text-gray-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <RichComposer
        value={draft}
        onChange={setDraft}
        placeholder="Write a message..."
        submitLabel="Send"
        busy={busy}
        rows={2}
        onSubmit={async () => {
          if (!org || !token) return;
          const body = composerValue(draft);
          if (!body) return;
          setBusy(true);
          try {
            await api.commons.sendToThread(org.id, threadId, body, token);
            setDraft('');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That did not send');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
