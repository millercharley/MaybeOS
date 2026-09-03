'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, Article, ArticleCompliance, ArticleSummary } from '@/lib/api';
import { RichComposer } from '@/components/composer/rich-composer';
import { ImageUploader } from '@/components/ui/image-uploader';
import { timeAgo } from '@/lib/relative-time';

/**
 * Writing the Knowledge Center (PRD §6.1, §6.3).
 *
 * Two things this screen has to get right, and both are about not surprising
 * anybody:
 *
 * **A material edit is asked about, never guessed.** Once people have agreed
 * to something, changing it is a decision with consequences for them — so
 * saving a published required article puts the question in front of the admin
 * in the words that describe what will happen, rather than offering a
 * checkbox labelled "material" that means nothing until you have read the
 * code.
 *
 * **Compliance is a list of people, not a percentage.** "68% acknowledged" is
 * a number to feel good or bad about; "these eleven people have not" is
 * something an organiser can act on, by asking them.
 */
export default function AdminWelcomePage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [editing, setEditing] = useState<Article | null>(null);
  const [compliance, setCompliance] = useState<ArticleCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askMaterial, setAskMaterial] = useState(false);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setArticles(await api.belonging.articles(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load these');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const save = async (material?: boolean) => {
    if (!editing || !token || !orgId) return;
    await run(async () => {
      await api.belonging.updateArticle(
        orgId,
        editing.id,
        {
          title: editing.title,
          body: editing.body,
          requiresAcknowledgment: editing.requiresAcknowledgment,
          ...(material !== undefined && { material }),
        },
        token,
      );
      setAskMaterial(false);
      setEditing(null);
      await load();
    });
  };

  const move = async (index: number, by: -1 | 1) => {
    if (!token || !orgId) return;
    const next = [...articles];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setArticles(next);
    await api.belonging.reorderArticles(orgId, next.map((a) => a.id), token);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (compliance) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <button
          onClick={() => setCompliance(null)}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All articles
        </button>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">{compliance.article.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Version {compliance.article.version}
            {compliance.article.requiredSince &&
              ` · required since ${timeAgo(compliance.article.requiredSince)}`}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-3xl font-bold text-gray-900">
            {compliance.acknowledgedCount}
            <span className="text-lg font-normal text-gray-500"> of {compliance.total}</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${compliance.percentage}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">
            {compliance.outstanding.length === 0
              ? 'Everybody has agreed'
              : `${compliance.outstanding.length} still to agree`}
          </h2>
          {compliance.outstanding.length > 0 && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!token || !orgId) return;
                  const { reminded } = await api.belonging.remind(
                    orgId,
                    compliance.article.id,
                    token,
                  );
                  setError('');
                  alert(`Reminded ${reminded} ${reminded === 1 ? 'person' : 'people'}.`);
                })
              }
              className="btn-secondary text-sm"
            >
              <Send className="mr-1.5 inline h-4 w-4" />
              Remind them
            </button>
          )}
        </div>

        {/* People, not a percentage: a name is something an organiser can do
            something about. */}
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {compliance.outstanding.map((m) => (
            <li key={m.memberId} className="flex flex-wrap items-center justify-between px-4 py-3 text-sm gap-3">
              <span className="text-gray-900">{m.name ?? m.email}</span>
              <span className="text-gray-400">member since {timeAgo(m.memberSince)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (editing) {
    const wasLive = editing.state === 'PUBLISHED' && editing.requiresAcknowledgment;
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <button
          onClick={() => {
            setEditing(null);
            setAskMaterial(false);
          }}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All articles
        </button>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <ImageUploader
          what="Cover images"
          addLabel="Add a cover image"
          imageUrl={editing.coverImageUrl}
          onUpload={async (data, mimeType) => {
            if (!token || !orgId) return;
            setEditing(
              await api.belonging.uploadArticleCover(orgId, editing.id, { data, mimeType }, token),
            );
            await load();
          }}
          onRemove={async () => {
            if (!token || !orgId) return;
            await api.belonging.removeArticleCover(orgId, editing.id, token);
            setEditing({ ...editing, coverImageUrl: null });
            await load();
          }}
        />

        <input
          value={editing.title}
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          placeholder="3. Guests and keys"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-semibold"
        />
        <p className="-mt-3 text-xs text-gray-500">
          Number it yourself if you want it numbered — MaybeOS won&rsquo;t renumber anything you
          wrote.
        </p>

        <RichComposer
          value={editing.body}
          onChange={(body) => setEditing({ ...editing, body })}
          placeholder="What does somebody new need to know?"
          submitLabel="Save"
          rows={12}
        />

        <label className="flex items-start gap-2.5 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={editing.requiresAcknowledgment}
            onChange={(e) => setEditing({ ...editing, requiresAcknowledgment: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          <span>
            Ask every member to read and agree to this
            <span className="mt-0.5 block text-xs text-gray-500">
              Until they do, they can read everything here but can&rsquo;t post, comment, vote or
              RSVP. People who are already members get a grace period first.
            </span>
          </span>
        </label>

        {/* The question, in the words that describe what happens — not a
            checkbox labelled "material" that means nothing until you have read
            the code. */}
        {askMaterial && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-medium text-amber-900">
              People have already agreed to this. What kind of change is it?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => save(false)} disabled={busy} className="btn-secondary text-sm">
                A minor edit — keep their agreement
              </button>
              <button onClick={() => save(true)} disabled={busy} className="btn-primary text-sm">
                A real change — ask everyone again
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Asking again emails every member and starts their grace period over.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => (wasLive ? setAskMaterial(true) : save())}
            className="btn-primary text-sm"
          >
            {busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
            Save
          </button>
          {editing.state === 'DRAFT' ? (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!token || !orgId) return;
                  await api.belonging.publishArticle(orgId, editing.id, token);
                  setEditing(null);
                  await load();
                })
              }
              className="btn-secondary text-sm"
            >
              Publish
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!token || !orgId) return;
                  await api.belonging.unpublishArticle(orgId, editing.id, token);
                  setEditing(null);
                  await load();
                })
              }
              className="btn-secondary text-sm"
            >
              Unpublish
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcoming</h1>
          <p className="mt-1 text-sm text-gray-500">
            How this community works, in your own words and your own order.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!token || !orgId) return;
              const created = await api.belonging.createArticle(
                orgId,
                { title: 'Untitled', body: '' },
                token,
              );
              await load();
              setEditing(created);
            })
          }
          className="btn-primary text-sm"
        >
          <Plus className="mr-1.5 inline h-4 w-4" />
          New article
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {articles.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-gray-500">
            Nothing written yet.
          </li>
        )}
        {articles.map((a, i) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="text-gray-300 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === articles.length - 1}
                aria-label="Move down"
                className="text-gray-300 hover:text-gray-700 disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() =>
                run(async () => {
                  if (!token || !orgId) return;
                  setEditing(await api.belonging.article(orgId, a.id, token));
                })
              }
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate font-medium text-gray-900">{a.title}</p>
              <p className="text-xs text-gray-500">
                {a.state === 'DRAFT' ? 'Draft' : `Published · v${a.version}`}
                {a.requiresAcknowledgment && ' · required reading'}
              </p>
            </button>

            {a.requiresAcknowledgment && a.state === 'PUBLISHED' && (
              <button
                onClick={() =>
                  run(async () => {
                    if (!token || !orgId) return;
                    setCompliance(await api.belonging.compliance(orgId, a.id, token));
                  })
                }
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={`Who has agreed to ${a.title}`}
                title="Who has agreed"
              >
                <Users className="h-4 w-4" />
              </button>
            )}

            <button
              onClick={() =>
                run(async () => {
                  if (!token || !orgId) return;
                  if (!confirm(`Delete “${a.title}”? Agreements to it go too.`)) return;
                  await api.belonging.deleteArticle(orgId, a.id, token);
                  await load();
                })
              }
              aria-label={`Delete ${a.title}`}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
