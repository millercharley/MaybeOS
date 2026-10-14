'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, Loader2 } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Article, ArticleSummary, OutstandingReading } from '@/lib/api';
import { ArticleRow } from '@/components/belonging/article-row';
import { ArticleModal } from '@/components/belonging/article-modal';
import { timeUntil } from '@/lib/relative-time';
import { PageHeader } from '@/components/layout/page-header';

/**
 * The Handbook as a member sees it (BEL, PRD §6.1; renamed CMN-11).
 *
 * An ordered list a co-op decided the order of, in the co-op's own words,
 * with the numbering it typed itself. Everything here is readable without
 * agreeing to anything — the gate is on writing, never on reading, because
 * people have to be able to see what they are joining.
 */
export default function HandbookPage() {
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

  /**
   * Which article is open lives in the address (BEL-14).
   *
   * Charley: "It would be nice to reference a Handbook article in the Commons
   * and readers can simply click on a link to jump directly into the Handbook
   * with this article open to read."
   *
   * The handbook opened everything in a modal over the list, so there was
   * nothing to copy — every article had the same URL and a link could only
   * ever say "the handbook, somewhere in there". Putting the open article in
   * the query makes the link the thing that was already on screen, and gets
   * Back out of a modal for free, which people try first anyway.
   *
   * `?article=` rather than a path segment: `/handbook/start` is already a
   * route, and a dynamic sibling would shadow or be shadowed by it depending
   * on what somebody titles an article.
   */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wanted = params?.get('article') ?? null;

  const openArticle = async (id: string) => {
    if (!org || !token) return;
    const article = await api.belonging.article(org.id, id, token);
    setOpen(article);
    // The slug, because that is what somebody pastes into the Commons. The
    // API takes either, so an older link holding an id still works.
    router.replace(`${pathname}?article=${encodeURIComponent(article.slug)}`, { scroll: false });
  };

  const closeArticle = () => {
    setOpen(null);
    router.replace(pathname ?? '', { scroll: false });
  };

  /*
    Opening what the link asked for, once.

    Keyed on the slug rather than on `open`, or closing the modal would
    immediately reopen it — the address is cleared by the close, so this would
    see no article and do nothing, but a reader who arrived by link and then
    pressed Back would otherwise bounce between the two.
  */
  useEffect(() => {
    if (!org || !token || !wanted || open?.slug === wanted) return;

    let cancelled = false;
    api.belonging
      .article(org.id, wanted, token)
      .then((article) => {
        if (!cancelled) setOpen(article);
      })
      // A link to an article that has been deleted, or that this member
      // cannot see, leaves them on the handbook rather than on an error.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [org, token, wanted, open?.slug]);

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
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Handbook"
          description="How this community works, in its own words."
        />
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
          onClose={closeArticle}
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
