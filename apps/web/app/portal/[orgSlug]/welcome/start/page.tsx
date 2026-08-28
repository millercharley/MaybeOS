'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Shield } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Article, OutstandingReading } from '@/lib/api';
import { renderBodyHtml } from '@/lib/rich-text';
import { timeUntil } from '@/lib/relative-time';

/**
 * Being walked through what a community asks of you (PRD §6.2).
 *
 * **In the co-op's own order**, one at a time, because a list of seven links
 * and an instruction to read them all is a list nobody finishes. The order is
 * the one an organiser set, so a co-op that put "You BELONG" before the Code
 * of Conduct gets that sequence rather than whatever the database returned.
 *
 * Three things it deliberately does not do:
 *
 * - **It does not trap anybody.** Every screen has a way back to the
 *   community, because reading is never gated and somebody who wants to look
 *   around before agreeing is doing exactly what they should be able to.
 * - **It does not fake a signature.** The checkbox is a real act and scrolling
 *   is not one. A co-op holding somebody to a document they scrolled past has
 *   a record it cannot stand behind.
 * - **It does not pretend the last one is the end of onboarding.** Finishing
 *   lands on the Knowledge Center, where the things that were never required
 *   are still worth reading.
 */
export default function WelcomeStartPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);

  const [outstanding, setOutstanding] = useState<OutstandingReading | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    try {
      const owed = await api.belonging.outstandingReading(org.id, token);
      setOutstanding(owed);

      // Blocking first, then whatever is merely owed — the order an
      // organiser chose, filtered to what this member has not done.
      const next = owed.blocking[0] ?? owed.inGrace[0]?.article ?? null;
      setArticle(next ? await api.belonging.article(org.id, next.id, token) : null);
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this');
    } finally {
      setLoading(false);
    }
  }, [org, token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
          <Check className="h-6 w-6 text-green-600" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-gray-900">That&rsquo;s everything</h1>
        <p className="mt-3 text-gray-600">
          Nothing else is asked of you. There is more in the Knowledge Center worth reading, and
          none of it is compulsory.
        </p>
        <Link href={`/portal/${org?.slug}/welcome`} className="btn-primary mt-6 inline-block text-sm">
          Have a look
        </Link>
      </div>
    );
  }

  const remaining = (outstanding?.blocking.length ?? 0) + (outstanding?.inGrace.length ?? 0);
  const isBlocking = outstanding?.blocking.some((a) => a.id === article.id) ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {remaining === 1 ? 'One thing to read' : `${remaining} things to read`}
        </p>
        {/* Never a dead end. Reading is open and somebody who wants to look
            around first should be able to. */}
        <Link
          href={`/portal/${org?.slug}/commons`}
          className="text-sm text-gray-500 underline hover:text-gray-900"
        >
          Look around first
        </Link>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {article.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.coverImageUrl} alt="" className="max-h-72 w-full object-cover" />
        )}
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
          {article.author?.name && (
            <p className="mt-1 text-sm text-gray-500">by {article.author.name}</p>
          )}
          <div
            className="rich-body mt-5 text-[15px] text-gray-800"
            dangerouslySetInnerHTML={{ __html: renderBodyHtml(article.body) }}
          />
        </div>
      </article>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="flex items-start gap-2 text-sm text-amber-900">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {isBlocking
              ? `${org?.name ?? 'This community'} asks you to agree to this before taking part.`
              : `${org?.name ?? 'This community'} asks you to agree to this. You have until ${
                  outstanding?.graceEndsAt ? timeUntil(outstanding.graceEndsAt) : 'a little while'
                }.`}
          </span>
        </p>

        <label className="mt-3 flex items-start gap-2.5 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          I have read and understand this
        </label>

        <button
          disabled={!confirmed || busy}
          onClick={async () => {
            if (!org || !token) return;
            setBusy(true);
            try {
              await api.belonging.acknowledgeArticle(org.id, article.id, token);
              await load();
              window.scrollTo({ top: 0 });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'That did not save');
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary mt-3 text-sm disabled:opacity-50"
        >
          {busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
          {remaining > 1 ? 'Agree and read the next one' : 'Agree'}
        </button>
      </div>
    </div>
  );
}
