'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Article, ArticleSummary, OutstandingReading } from '@/lib/api';
import { ArticleRow } from '@/components/belonging/article-row';
import { ArticleModal } from '@/components/belonging/article-modal';
import { timeUntil } from '@/lib/relative-time';

/**
 * The Knowledge Center as a member sees it (BEL, PRD §6.1).
 *
 * An ordered list a co-op decided the order of, in the co-op's own words,
 * with the numbering it typed itself. Everything here is readable without
 * agreeing to anything — the gate is on writing, never on reading, because
 * people have to be able to see what they are joining.
 */
export default function WelcomePage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [outstanding, setOutstanding] = useState<OutstandingReading | null>(null);
  const [open, setOpen] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    try {
      const [list, owed] = await Promise.all([
        api.belonging.articles(org.id, token),
        api.belonging.outstandingReading(org.id, token),
      ]);
      setArticles(list);
      setOutstanding(owed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this');
    } finally {
      setLoading(false);
    }
  }, [org, token]);

  useEffect(() => {
    load();
  }, [load]);

  const openArticle = async (id: string) => {
    if (!org || !token) return;
    setOpen(await api.belonging.article(org.id, id, token));
  };

  const refreshOpen = async () => {
    if (!org || !token || !open) return;
    setOpen(await api.belonging.article(org.id, open.id, token));
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const owedIds = new Set([
    ...(outstanding?.blocking.map((a) => a.id) ?? []),
    ...(outstanding?.inGrace.map((e) => e.article.id) ?? []),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome</h1>
        <p className="mt-1 text-sm text-gray-500">
          What {org?.name ?? 'this community'} would like you to know.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* The countdown, when something is owed but not yet blocking. Stated as
          what happens and when, rather than as a warning — a member inside
          their grace period has done nothing wrong. */}
      {outstanding && outstanding.blocking.length === 0 && outstanding.graceEndsAt && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          There {outstanding.inGrace.length === 1 ? 'is one thing' : `are ${outstanding.inGrace.length} things`}{' '}
          here to read and agree to. You can carry on as normal until{' '}
          <b>{timeUntil(outstanding.graceEndsAt)}</b>, after which you will need to agree before
          posting or RSVPing.
        </p>
      )}

      {outstanding && outstanding.blocking.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Before you can post, comment, vote or RSVP here, this community asks you to read and
          agree to{' '}
          {outstanding.blocking.length === 1 ? 'one thing' : `${outstanding.blocking.length} things`}{' '}
          below. Reading everything else stays open.
        </p>
      )}

      {articles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Nothing here yet. This is where {org?.name ?? 'the community'} writes down how it works.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {articles.map((article) => (
            <ArticleRow key={article.id} article={article} onOpen={() => openArticle(article.id)} />
          ))}
        </div>
      )}

      {open && org && token && (
        <ArticleModal
          article={open}
          canAcknowledge={owedIds.has(open.id) || open.requiresAcknowledgment}
          onClose={() => setOpen(null)}
          onLike={async () => {
            await api.belonging.likeArticle(org.id, open.id, token);
            await refreshOpen();
          }}
          onComment={async (body) => {
            await api.belonging.commentOnArticle(org.id, open.id, body, token);
            await refreshOpen();
          }}
          onAcknowledge={async () => {
            await api.belonging.acknowledgeArticle(org.id, open.id, token);
            await refreshOpen();
          }}
        />
      )}
    </div>
  );
}
