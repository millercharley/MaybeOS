'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Comment } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { AttachmentList } from '@/components/composer/attachment-list';
import { MemberName } from '@/components/member/member-name';
import { renderBodyHtml, isBlankBody } from '@/lib/rich-text';
import { uploadAttachments } from '@/lib/attachments';

/**
 * The conversation about one thing the co-op is running (CMN-22).
 *
 * **One conversation, in two places that show it.** Charley: "all comments on
 * an event page or teaching page should sync to the identical conversation in
 * the Commons. This prevents two places with separate conversations about the
 * same event."
 *
 * There is nothing to sync, because there is nothing to sync *from*: this runs
 * against the Commons post the event or offering carries, so a comment typed
 * here is the same row as a comment typed in #Events, written by the same
 * endpoint and moderated by the same rules. Two stores kept in step would be
 * two stores to disagree.
 *
 * Lifted out of the event page, where it had lived since EVT-11, when teaching
 * needed the same thing. Copying it would have been the second place.
 *
 * What differs between the two callers is only *which* thread to open, so that
 * is what they pass.
 */
export function Discussion({
  orgId,
  token,
  readThread,
  startThread,
  privateMessage,
  placeholder = 'What are your thoughts?',
}: {
  orgId: string;
  token: string;
  /** Read the thread, if there is one. Never creates (EVT-42). */
  readThread: () => Promise<{ postId: string | null }>;
  /** Make it, on the first comment. Returns null when it may not have one. */
  startThread: () => Promise<{ postId: string | null }>;
  /** What to say when this thing is kept off the lists and has no thread. */
  privateMessage: string;
  placeholder?: string;
}) {
  const [postId, setPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const viewer = useAuthStore((state) => state.user);
  const viewerIsAdmin = Boolean(
    viewer?.orgs?.find((o) => o.orgId === orgId)?.role === 'ADMIN',
  );

  /** Withdraw a comment, or take one down (CMN-19). */
  async function removeComment(commentId: string) {
    if (busy) return;
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      await api.commons.deleteComment(orgId, commentId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be deleted');
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      /*
        A read (EVT-42).

        This used to create the thread, on the reasoning that making one per
        event would fill the Commons with empty threads. It filled them anyway
        — opening an event page was enough — and the posts were attributed to
        whoever had opened it. Three appeared in one browsing session, five
        days after those events were published, with no comments on any of
        them. The thread is made by the first comment now; see `submit`.
      */
      const { postId: id } = await readThread();
      setPostId(id);
      if (id) {
        const post = await api.commons.getPost(orgId, id, token);
        setComments(post.comments ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the discussion');
    }
  }, [readThread]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (isBlankBody(draft) && files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      /*
        The first comment is what makes the thread (EVT-42).

        Which means a thread in #Events is a conversation rather than a page
        somebody opened. A private event never gets one — the channel is read
        by the whole co-op — so there is nothing to post a comment onto.
      */
      const thread = postId ? { postId } : await startThread();
      if (!thread.postId) {
        setError(privateMessage);
        return;
      }
      setPostId(thread.postId);

      const comment = await api.commons.addComment(
        orgId,
        thread.postId,
        { body: composerValue(draft) },
        token,
      );
      if (files.length > 0) {
        await uploadAttachments(orgId, files, { commentId: comment.id }, token);
        setFiles([]);
      }
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your comment was not posted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-gray-200 pt-6">
      <h2 className="mb-3 text-base font-semibold text-gray-900">
        {comments.length > 0 ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Discussion'}
      </h2>

      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}

      <div className="mb-4 space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <MemberName
                userId={comment.author?.id}
                name={comment.author?.name || 'Member'}
                className="text-xs font-medium text-gray-900"
              />
              <span className="text-[11px] text-gray-400">
                {new Date(comment.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div
              className="prose prose-sm mt-0.5 max-w-none whitespace-pre-wrap text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
            />
            <AttachmentList orgId={orgId} token={token} commentId={comment.id} />
            {/*
              Their own, or anybody's if they run the place (CMN-19). These are
              ordinary Commons comments — the same post, the same endpoint — so
              they get the same right to be withdrawn.
            */}
            {(comment.author?.id === viewer?.id || viewerIsAdmin) && (
              <button
                type="button"
                onClick={() => removeComment(comment.id)}
                disabled={busy}
                className="mt-1 text-xs text-gray-400 hover:text-red-600"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>

      <RichComposer
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        placeholder={placeholder}
        submitLabel="Post"
        busy={busy}
        rows={2}
        files={files}
        onFilesChange={setFiles}
      />
    </section>
  );
}
