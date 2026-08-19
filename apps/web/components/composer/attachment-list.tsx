'use client';

import { useEffect, useState } from 'react';
import { Paperclip, Download } from 'lucide-react';
import { api, Attachment } from '@/lib/api';
import { formatBytes, isImage } from '@/lib/attachments';

/**
 * What is attached to a post, comment or event.
 *
 * Fetched per owner rather than embedded in the parent payload, because every
 * URL here is signed and short-lived — the bucket is private, since these hang
 * off members-only posts and private events. Baking them into a post list
 * would mean handing out signed URLs for files nobody opens, and having them
 * expire while the page is still on screen.
 */
export function AttachmentList({
  orgId,
  token,
  postId,
  commentId,
  eventId,
}: {
  orgId: string;
  token: string;
  postId?: string;
  commentId?: string;
  eventId?: string;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.attachments
      .list(orgId, { postId, commentId, eventId }, token)
      .then((found) => {
        if (!cancelled) setAttachments(found);
      })
      // Silent: a post whose attachments fail to load should still be
      // readable, and there is nothing a member can do about it here.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId, token, postId, commentId, eventId]);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImage(a.mimeType) && a.url);
  const files = attachments.filter((a) => !isImage(a.mimeType) || !a.url);

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <a
              key={a.id}
              href={a.url!}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border border-gray-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url!}
                alt={a.fileName}
                // Kept small on purpose: a shared photo should not push the
                // conversation off the screen.
                className="max-h-64 max-w-xs object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((a) => (
            <li key={a.id}>
              <a
                href={a.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:border-gray-300"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="max-w-[16rem] truncate">{a.fileName}</span>
                <span className="text-xs text-gray-400">{formatBytes(a.sizeBytes)}</span>
                <Download className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
