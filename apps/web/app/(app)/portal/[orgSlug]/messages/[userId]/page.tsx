'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lightbulb, X } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, DirectMessage } from '@/lib/api';
import { renderBodyHtml } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { timeAgo } from '@/lib/relative-time';

/**
 * One conversation, and — if you are somebody's buddy — the prompts for it
 * (CMN-08, PRD §5.4).
 *
 * This is where the whole Buddy System lands. Both introduction emails point
 * here, and §5.3 is explicit that **sending the first message is the success
 * action** — so the composer is the first thing in reach and the suggestions
 * sit directly above it, where somebody stuck for an opening line is already
 * looking.
 *
 * A suggestion **fills the composer and stops**. Nothing sends on a tap. A
 * welcome that a co-op wrote and a member merely transmitted is not a
 * welcome, and the edit somebody makes on the way to sending it is the part
 * that makes it theirs.
 */
export default function ThreadPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const otherUserId = useParams<{ userId: string }>().userId;

  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; body: string }>>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const other =
    messages.find((m) => m.sender.id === otherUserId)?.sender ??
    messages.find((m) => m.receiver.id === otherUserId)?.receiver ??
    null;

  const load = useCallback(async () => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    try {
      const [thread, prompts] = await Promise.all([
        api.commons.getConversation(org.id, otherUserId, token),
        // Empty unless the API agrees this viewer is that person's buddy.
        api.belonging.threadSuggestions(org.id, otherUserId, token).catch(() => ({
          pairingId: null,
          suggestions: [],
        })),
      ]);
      setMessages(thread);
      setSuggestions(prompts.suggestions);
      await api.commons.markConversationRead(org.id, otherUserId, token).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this conversation');
    } finally {
      setLoading(false);
    }
  }, [org, token, otherUserId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const myId = messages.find((m) => m.sender.id !== otherUserId)?.sender.id ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/portal/${org?.slug}/messages`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Messages
      </Link>

      <h1 className="font-display text-2xl leading-tight text-ink">{other?.name ?? 'Conversation'}</h1>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            Nothing here yet. Whatever you write first is fine.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender.id === myId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
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
          );
        })}
        <div ref={bottom} />
      </div>

      {/* Only ever rendered for the buddy — the API returns nothing to anyone
          else, so this cannot be revealed by poking at the page. */}
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
            await api.commons.sendMessage(org.id, otherUserId, body, token);
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
