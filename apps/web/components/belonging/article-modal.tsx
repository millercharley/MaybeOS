'use client';

import { useEffect, useState } from 'react';
import { Check, Heart, Loader2, MessageCircle, Shield, X } from 'lucide-react';
import { Article, ArticleComment } from '@/lib/api';
import { renderBodyHtml } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { timeAgo } from '@/lib/relative-time';

/**
 * Reading an article, following the reference layout.
 *
 * A modal rather than a page, because the index is the thing a member is
 * moving through — closing one article should put them back in the list at
 * the row they left, not at the top of a page they have to find their place
 * in again.
 *
 * The author row carries the writer's **headline** under their name, which is
 * the small line that makes a set of house rules read as written by a person
 * rather than issued by an institution. MaybeOS already has it from the
 * member profile, so it costs nothing to show.
 */
export function ArticleModal({
  article,
  canAcknowledge,
  onClose,
  onLike,
  onComment,
  onAcknowledge,
}: {
  article: Article;
  /** True when this article is one the member still owes agreement on. */
  canAcknowledge: boolean;
  onClose: () => void;
  onLike: () => void;
  onComment: (body: string) => Promise<void>;
  onAcknowledge: () => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [agreeing, setAgreeing] = useState(false);

  // Escape closes, because a modal that traps you is a modal you resent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const publishedOn = article.publishedAt ?? article.createdAt;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/50 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={article.title}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 className="truncate text-xl font-bold text-gray-900">{article.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {article.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.coverImageUrl} alt="" className="max-h-80 w-full object-cover" />
        )}

        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            {article.author?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={article.author.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                {(article.author?.name ?? '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900">{article.author?.name ?? 'A member'}</span>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                  Admin
                </span>
                <span className="text-sm text-gray-500">
                  {new Date(publishedOn).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </p>
              {article.author?.headline && (
                <p className="mt-0.5 text-sm text-gray-500">{article.author.headline}</p>
              )}
            </div>
          </div>

          <div
            className="rich-body mt-5 text-[15px] text-gray-800"
            dangerouslySetInnerHTML={{ __html: renderBodyHtml(article.body) }}
          />

          {/* The agreement, when one is owed. An explicit checkbox and button,
              never scroll depth — somebody who scrolled past has not agreed to
              anything, and a co-op that treats it as agreement has a record it
              cannot stand behind. */}
          {article.requiresAcknowledgment && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              {article.acknowledgedByMe ? (
                <p className="flex items-center gap-2 text-sm text-green-800">
                  <Check className="h-4 w-4 shrink-0" />
                  You have read and agreed to this.
                </p>
              ) : (
                <>
                  <p className="flex items-start gap-2 text-sm text-amber-900">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{article.author?.name?.split(' ')[0] ?? 'This community'} asks every member to read and agree to this one.</span>
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
                    disabled={!confirmed || agreeing || !canAcknowledge}
                    onClick={async () => {
                      setAgreeing(true);
                      try {
                        await onAcknowledge();
                      } finally {
                        setAgreeing(false);
                      }
                    }}
                    className="btn-primary mt-3 text-sm disabled:opacity-50"
                  >
                    {agreeing && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
                    Agree
                  </button>
                </>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between border-t border-gray-100 pt-4 gap-3">
            <div className="flex items-center gap-4">
              <button
                onClick={onLike}
                aria-label={article.likedByMe ? 'Unlike' : 'Like'}
                aria-pressed={article.likedByMe}
                className={`rounded-lg p-1.5 hover:bg-gray-100 ${
                  article.likedByMe ? 'text-red-500' : 'text-gray-500'
                }`}
              >
                <Heart className={`h-5 w-5 ${article.likedByMe ? 'fill-current' : ''}`} />
              </button>
              <span className="flex items-center gap-1.5 text-gray-500">
                <MessageCircle className="h-5 w-5" aria-hidden />
              </span>
            </div>
            <p className="text-sm text-gray-500">
              {article.likeCount} {article.likeCount === 1 ? 'like' : 'likes'} ·{' '}
              {article.commentCount} {article.commentCount === 1 ? 'comment' : 'comments'}
            </p>
          </div>

          <div className="mt-4 space-y-4">
            {article.comments.map((comment: ArticleComment) => (
              <div key={comment.id} className="flex gap-3">
                {comment.member.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comment.member.user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                    {(comment.member.user.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold text-gray-900">
                      {comment.member.user.name ?? 'A member'}
                    </span>{' '}
                    <span className="text-gray-500">{timeAgo(comment.createdAt)}</span>
                  </p>
                  <div
                    className="mt-0.5 text-sm text-gray-800"
                    dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <RichComposer
              value={draft}
              onChange={setDraft}
              placeholder="What are your thoughts?"
              submitLabel="Comment"
              busy={busy}
              rows={2}
              onSubmit={async () => {
                const body = composerValue(draft);
                if (!body) return;
                setBusy(true);
                try {
                  await onComment(body);
                  setDraft('');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
