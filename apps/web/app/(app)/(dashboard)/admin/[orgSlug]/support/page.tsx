'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, LifeBuoy, Mail, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, type SupportArticle } from '@/lib/api';
import { categoriesOf, search } from '@/lib/support-search';
import { SUPPORT_EMAIL, supportMailto } from '@/lib/support';
import { PageHeader } from '@/components/layout/page-header';
import { ArticleEditor } from '@/components/support/article-editor';

/**
 * MaybeOS's own documentation (PLT-05).
 *
 * Charley: "when this page opens, the Admin should see MaybeOS documentation
 * on how to manage everything, including setup decisions and migration
 * options... Make the documentation appear like completed Handbook articles,
 * and make sure that I, as a Super Admin, can edit the articles and add
 * additional screenshots. All Admins should see this documentation. The
 * documentation should be searchable. There should also be a contact option
 * to email support@maybeos.org."
 *
 * One page rather than a list and a reader: a dozen articles is a thing to
 * scan, not to navigate. Choosing one opens it in place, which keeps the
 * search results where they were when you go back.
 */
export default function SupportPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.globalRole === 'PLATFORM_ADMIN';

  const [articles, setArticles] = useState<SupportArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [editing, setEditing] = useState<SupportArticle | 'new' | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    api.support
      .list(token)
      .then(setArticles)
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const results = useMemo(() => search(articles, query), [articles, query]);
  const categories = useMemo(() => categoriesOf(results), [results]);
  const open = articles.find((a) => a.slug === openSlug) ?? null;

  async function remove(article: SupportArticle) {
    if (!token) return;
    if (!window.confirm(`Delete “${article.title}”? Its screenshots go with it.`)) return;
    await api.support.remove(article.id, token).catch(() => {});
    setOpenSlug(null);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Support"
        description="How to run MaybeOS: the decisions to make, and how to make them."
        actions={
          canEdit && !editing ? (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New article
            </button>
          ) : null
        }
      />

      {editing ? (
        <ArticleEditor
          article={editing === 'new' ? null : editing}
          categories={categoriesOf(articles)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : open ? (
        <Reader
          article={open}
          canEdit={canEdit}
          onBack={() => setOpenSlug(null)}
          onEdit={() => setEditing(open)}
          onDelete={() => remove(open)}
        />
      ) : (
        <>
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the documentation — try “sign-in links” or “joining fee”"
              className="input w-full pl-9"
              aria-label="Search the documentation"
            />
          </label>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : results.length === 0 ? (
            <div className="mt-8 rounded-lg border border-dashed border-gray-200 py-12 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
              <p className="mt-3 font-medium text-gray-900">Nothing matches “{query}”.</p>
              <p className="mt-1 text-sm text-gray-500">
                If the answer is not here, write to us — the question is worth an article.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-10">
              {categories.map((category) => (
                <section key={category}>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                    {category}
                  </h2>
                  <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {results
                      .filter((a) => a.category === category)
                      .map((article) => (
                        <button
                          key={article.id}
                          type="button"
                          onClick={() => setOpenSlug(article.slug)}
                          className="block w-full px-4 py-3 text-left transition-colors hover:bg-gray-50"
                        >
                          <p className="flex items-center gap-2 font-medium text-gray-900">
                            {article.title}
                            {article.state === 'DRAFT' && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Draft
                              </span>
                            )}
                          </p>
                          {article.summary && (
                            <p className="mt-0.5 text-sm text-gray-500">{article.summary}</p>
                          )}
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <ContactCard />
        </>
      )}
    </div>
  );
}

/**
 * One article, reading like a finished handbook page.
 *
 * The body is HTML written by a platform admin — the same trust boundary as a
 * co-op's own handbook, where an organiser's words are rendered as they wrote
 * them. Nobody else can write here.
 */
function Reader({
  article,
  canEdit,
  onBack,
  onEdit,
  onDelete,
}: {
  article: SupportArticle;
  canEdit: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          ← All articles
        </button>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" onClick={onEdit} className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="btn-ghost inline-flex items-center gap-1.5 text-sm text-[var(--danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </button>
          </div>
        )}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {article.category}
      </p>
      <h1 className="mt-1 font-display text-2xl leading-tight text-ink">{article.title}</h1>
      {article.summary && <p className="mt-2 text-gray-600">{article.summary}</p>}

      <div
        className="prose prose-sm mt-6 max-w-none text-gray-700 prose-headings:font-semibold prose-headings:text-gray-900"
        dangerouslySetInnerHTML={{ __html: article.body }}
      />

      {article.images.length > 0 && (
        <div className="mt-8 space-y-6 border-t border-gray-100 pt-6">
          {article.images.map((image) =>
            image.url ? (
              <figure key={image.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.caption ?? ''}
                  className="w-full rounded-lg border border-gray-200"
                />
                {image.caption && (
                  <figcaption className="mt-2 text-sm text-gray-500">{image.caption}</figcaption>
                )}
              </figure>
            ) : null,
          )}
        </div>
      )}

      <ContactCard />
    </article>
  );
}

/** Where to write when the documentation does not have the answer. */
function ContactCard() {
  return (
    <section className="mt-10 rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h2 className="inline-flex items-center gap-2 font-semibold text-gray-900">
        <LifeBuoy className="h-4 w-4 text-gray-400" aria-hidden="true" />
        Still stuck?
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Write to us with a screenshot and what you were trying to do. MaybeOS cannot look inside
        your co-op&rsquo;s account, so what you saw is the most useful thing you can send.
      </p>
      <a href={supportMailto()} className="btn-primary mt-3 inline-flex items-center gap-2 text-sm">
        <Mail className="h-4 w-4" aria-hidden="true" />
        Email {SUPPORT_EMAIL}
      </a>
    </section>
  );
}
