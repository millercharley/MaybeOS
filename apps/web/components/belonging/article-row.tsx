'use client';

import { CornerDownRight, Heart, MessageCircle, MoreHorizontal } from 'lucide-react';
import { ArticleSummary } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';

/**
 * One row of the Knowledge Center index, following the reference layout.
 *
 * The details that carry the meaning, and that a description of the screen
 * would lose:
 *
 * - **The turned arrow appears only on a reply.** "↳ Rasul replied 10 months
 *   ago" and "Charley posted 2 years ago" are different facts — one says the
 *   article is still being talked about, the other that it has been settled
 *   since it went up — and the glyph is what makes that legible at a glance
 *   rather than something you read word by word.
 * - **A liked heart is filled and red, and the count goes red with it.** Half
 *   the signal is lost if the number stays grey.
 * - **The whole row is one target.** The counts are information, not buttons;
 *   liking happens inside the article, where you have read the thing.
 */
export function ArticleRow({
  article,
  onOpen,
  onMenu,
}: {
  article: ArticleSummary;
  onOpen: () => void;
  onMenu?: () => void;
}) {
  const liked = article.likedByMe;

  return (
    <div className="group flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {article.author?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.author.avatarUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
            {(article.author?.name ?? '?').charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{article.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            {article.lastActivity.kind === 'replied' && (
              <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate">
              {article.lastActivity.who ?? 'Someone'}{' '}
              {article.lastActivity.kind === 'replied' ? 'replied' : 'posted'}{' '}
              {timeAgo(article.lastActivity.at)}
            </span>
          </p>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-4 text-sm text-gray-500">
        {article.state === 'DRAFT' && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            Draft
          </span>
        )}
        {article.requiresAcknowledgment && (
          <span
            className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
            title="Members must read and agree to this"
          >
            Required
          </span>
        )}

        <span className={`flex items-center gap-1.5 ${liked ? 'text-red-500' : ''}`}>
          <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} aria-hidden />
          {article.likeCount}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle className="h-4 w-4" aria-hidden />
          {article.commentCount}
        </span>

        {onMenu && (
          <button
            onClick={onMenu}
            aria-label={`More for ${article.title}`}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
