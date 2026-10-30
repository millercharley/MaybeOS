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
  publicEvent,
  files,
}: {
  orgId: string;
  token: string;
  postId?: string;
  commentId?: string;
  eventId?: string;
  /**
   * Read the files without a token, for a public event (EVT-14).
   *
   * A stranger arriving from a link shared on social has no membership and no
   * token, and until this existed the co-op's poster simply did not render
   * for them — the page came up and the images it was advertising with did
   * not. Only ever the event's own files; a comment underneath it stays
   * members-only, which the API enforces rather than this trusting it.
   */
  publicEvent?: { orgSlug: string; eventSlug: string };
  /**
   * The files, where the caller already has them (CMN-28).
   *
   * The Commons feed now ships each post's attachments with the post, so a
   * channel of eleven posts makes one request rather than twelve. Before
   * this, every rendered post fetched its own — eleven calls inside the same
   * millisecond on production, each half a second warm and six and a half
   * cold.
   *
   * An empty array is an answer, not an absence: it means "this post has
   * none", and the component must not go and ask. Only `undefined` means the
   * caller does not know, which is still true of comments and of the public
   * event page.
   */
  files?: Attachment[];
}) {
  const [fetched, setFetched] = useState<Attachment[]>([]);
  const given = files !== undefined;
  const attachments = given ? files : fetched;

  useEffect(() => {
    // Nothing to ask for: the caller already knows (CMN-28).
    if (given) return;

    let cancelled = false;
    (publicEvent
      ? api.attachments.publicEventFiles(publicEvent.orgSlug, publicEvent.eventSlug)
      : api.attachments.list(orgId, { postId, commentId, eventId }, token))
      .then((found) => {
        if (!cancelled) setFetched(found);
      })
      // Silent: a post whose attachments fail to load should still be
      // readable, and there is nothing a member can do about it here.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [given, orgId, token, postId, commentId, eventId, publicEvent?.orgSlug, publicEvent?.eventSlug]);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImage(a.mimeType) && a.url);
  // Renamed from `files` when that became the prop above (CMN-28): these are
  // the ones shown as a row rather than a thumbnail.
  const documents = attachments.filter((a) => !isImage(a.mimeType) || !a.url);

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

      {documents.length > 0 && (
        <ul className="space-y-1">
          {documents.map((a) => (
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
