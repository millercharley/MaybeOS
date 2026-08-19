'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import {
  MessageSquare, Pin, BookOpen, ChevronLeft,
} from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Channel, Post, Proposal, Collection, CollectionPage, Comment } from '@/lib/api';
import { sanitizeWikiHtml } from '@/lib/wiki-html';
import { renderBodyHtml, isBlankBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { uploadAttachments } from '@/lib/attachments';
import { AttachmentList } from '@/components/composer/attachment-list';

type Tab = 'channels' | 'library' | 'proposals';

export default function PortalCommonsPage() {
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<Tab>('channels');

  if (!token) {
    return (
      <div className="py-12 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-gray-300" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Commons</h1>
        <p className="mt-2 text-sm text-gray-500">Sign in to participate in discussions and proposals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Commons</h1>

      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('channels')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'channels' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Channels
        </button>
        <button
          onClick={() => setTab('library')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'library' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Library
        </button>
        <button
          onClick={() => setTab('proposals')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'proposals' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Proposals
        </button>
      </div>

      {tab === 'channels' && <ChannelsSection />}
      {tab === 'library' && <LibrarySection />}
      {tab === 'proposals' && <ProposalsSection />}
    </div>
  );
}

function ChannelsSection() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [posting, setPosting] = useState(false);
  // Every call in this section used to `catch {}`. A member posted, it failed,
  // and the page said nothing — the post simply never appeared. Silence is the
  // worst possible answer here, because the member's own action is the thing
  // that vanished.
  const [error, setError] = useState('');

  useEffect(() => {
    if (!org || !token) { setLoading(false); return; }
    api.commons
      .listChannels(org.id, token)
      .then((chs) => {
        setChannels(chs);
        if (chs.length > 0) {
          setSelectedChannel(chs[0].id);
          return api.commons.listPosts(org.id, chs[0].id, token);
        }
        return null;
      })
      .then((data) => {
        if (data) setPosts(data.data || []);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load the Commons'),
      )
      .finally(() => setLoading(false));
  }, [org, token]);

  async function loadPosts(channelId: string) {
    if (!org || !token) return;
    setSelectedChannel(channelId);
    setPosts([]);
    setError('');
    try {
      const data = await api.commons.listPosts(org.id, channelId, token);
      setPosts(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load these posts');
    }
  }

  const [postFiles, setPostFiles] = useState<File[]>([]);

  async function handlePost(e?: FormEvent) {
    e?.preventDefault();
    // isBlankBody, not `.trim()`: an emptied contenteditable still holds
    // `<p><br></p>`, which is truthy and would post an empty message.
    // A file on its own is a post. Requiring words as well would mean a
    // member sharing a photo has to caption it.
    if (!org || !token || !selectedChannel) return;
    if (isBlankBody(newPost) && postFiles.length === 0) return;
    setPosting(true);
    setError('');
    try {
      const post = await api.commons.createPost(org.id, selectedChannel, { body: composerValue(newPost) }, token);
      // After the post exists, because an attachment needs its id. A failure
      // here leaves the post standing rather than losing what was written.
      if (postFiles.length > 0) {
        await uploadAttachments(org.id, postFiles, { postId: post.id }, token);
        setPostFiles([]);
      }
      setPosts((prev) => [post, ...prev]);
      // Only cleared once the post is actually saved. Clearing first would
      // throw away what somebody wrote the moment the request failed.
      setNewPost('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that');
    }
    setPosting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <>
        {error && <ErrorNote message={error} />}
        <p className="py-8 text-center text-sm text-gray-500">No channels yet.</p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      <div className="flex gap-6">
      <div className="w-48 shrink-0 space-y-1">
        {/*
          Pinned channels first, and said so. Admins can pin a channel (CMN-03)
          and the portal ignored it entirely, so the one ordering a co-op had
          deliberately chosen was the one place it did not apply.
        */}
        {[...channels]
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
          .map((ch) => (
            <button
              key={ch.id}
              onClick={() => loadPosts(ch.id)}
              className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                selectedChannel === ch.id ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {ch.isPinned && <Pin className="h-3 w-3 shrink-0 text-gray-400" aria-label="Pinned" />}
              <span className="truncate"># {ch.name}</span>
            </button>
          ))}
      </div>

      <div className="flex-1 space-y-4">
        <RichComposer
          value={newPost}
          onChange={setNewPost}
          onSubmit={() => handlePost()}
          placeholder="Write a message..."
          submitLabel="Post"
          busy={posting}
          files={postFiles}
          onFilesChange={setPostFiles}
        />

        {posts.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No posts in this channel yet. Be the first!</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} orgId={org!.id} token={token!} />
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * One post, and the conversation under it (CMN-06).
 *
 * The portal used to render a post's body and nothing else. Posts have titles
 * and the title carried the point — "New hours starting next month" was
 * invisible, leaving the body to start mid-thought. Comments existed on the
 * API and in the admin view since CMN-02; a member could read a post and had
 * no way to answer it, which is most of what a Commons is for.
 *
 * The thread is fetched only when opened. A channel can hold hundreds of
 * posts, and loading every comment on every one to show a count the list
 * already carries would be slow for information nobody asked for.
 */
function PostCard({ post, orgId, token }: { post: Post; orgId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Comment[] | null>(null);
  const [reactions, setReactions] = useState(post.reactions ?? []);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const commentCount = thread ? countThread(thread) : (post._count?.comments ?? 0);
  const reactionCount = reactions.length || post._count?.reactions || 0;

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (thread) return;
    setLoading(true);
    setError('');
    try {
      const full = await api.commons.getPost(orgId, post.id, token);
      setThread(full.comments ?? []);
      setReactions(full.reactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the replies');
    }
    setLoading(false);
  }

  const [commentFiles, setCommentFiles] = useState<File[]>([]);

  async function submitComment(e?: FormEvent) {
    e?.preventDefault();
    if (isBlankBody(draft) && commentFiles.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const comment = await api.commons.addComment(orgId, post.id, {
        body: composerValue(draft),
        ...(replyTo ? { parentId: replyTo } : {}),
      }, token);

      if (commentFiles.length > 0) {
        await uploadAttachments(orgId, commentFiles, { commentId: comment.id }, token);
        setCommentFiles([]);
      }
      // Re-read rather than splicing locally: a reply lands inside its parent,
      // and rebuilding that nesting by hand is how the screen and the database
      // start disagreeing.
      const full = await api.commons.getPost(orgId, post.id, token);
      setThread(full.comments ?? []);
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that reply');
    }
    setBusy(false);
  }

  async function react() {
    setError('');
    try {
      await api.commons.addReaction(orgId, post.id, '👍', token);
      const full = await api.commons.getPost(orgId, post.id, token);
      setReactions(full.reactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that');
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
          {post.author?.name?.charAt(0) || '?'}
        </div>
        <span className="text-sm font-medium text-gray-900">{post.author?.name || 'Member'}</span>
        <span className="text-xs text-gray-400">
          {new Date(post.createdAt).toLocaleDateString()}
        </span>
        {post.isPinned && (
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
            <Pin className="h-3 w-3" /> Pinned
          </span>
        )}
      </div>

      {post.title && (
        <h3 className="mt-2 text-sm font-semibold text-gray-900">{post.title}</h3>
      )}
      {/* Bodies are HTML now, and the plain text already stored still renders
          correctly — renderBodyHtml tells them apart rather than migrating a
          co-op's own words. */}
      <div
        className="prose prose-sm mt-1 max-w-none whitespace-pre-wrap text-sm text-gray-700"
        dangerouslySetInnerHTML={{ __html: renderBodyHtml(post.body) }}
      />
      <AttachmentList orgId={orgId} token={token} postId={post.id} />

      <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-2">
        <button onClick={react} className="text-xs text-gray-500 hover:text-gray-800">
          👍 {reactionCount > 0 ? reactionCount : ''}
        </button>
        <button onClick={toggle} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          {commentCount === 0
            ? open ? 'Hide' : 'Reply'
            : `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}`}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {error && <ErrorNote message={error} />}
          {loading && <p className="text-xs text-gray-400">Loading replies...</p>}

          {thread?.map((c) => (
            <CommentNode key={c.id} comment={c} depth={0} onReply={setReplyTo} activeReply={replyTo} />
          ))}

          <RichComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => submitComment()}
            files={commentFiles}
            onFilesChange={setCommentFiles}
            placeholder={replyTo ? 'Write a reply...' : 'Add a comment...'}
            submitLabel="Send"
            busy={busy}
            rows={2}
          />
          {replyTo && (
            <button
              onClick={() => setReplyTo(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Replies nest (CMN-02); indentation stops at two so a long thread stays readable. */
function CommentNode({
  comment, depth, onReply, activeReply,
}: {
  comment: Comment;
  depth: number;
  onReply: (id: string | null) => void;
  activeReply: string | null;
}) {
  // Its own rather than threaded through: this component is rendered
  // recursively for every reply, and passing the org and token down each level
  // is four props of ceremony for something both already know.
  const { org } = usePortal();
  const token = useAuthStore((state) => state.token);

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3' : ''}>
      <div className="rounded-lg bg-gray-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-900">
            {comment.author?.name || 'Member'}
          </span>
          <span className="text-[11px] text-gray-400">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div
          className="prose prose-sm mt-0.5 max-w-none whitespace-pre-wrap text-sm text-gray-700"
          dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
        />
        {org && token && (
          <AttachmentList orgId={org.id} token={token} commentId={comment.id} />
        )}
        <button
          onClick={() => onReply(activeReply === comment.id ? null : comment.id)}
          className="mt-1 text-[11px] text-gray-400 hover:text-gray-600"
        >
          {activeReply === comment.id ? 'Replying' : 'Reply'}
        </button>
      </div>
      {comment.replies?.map((r) => (
        <CommentNode
          key={r.id}
          comment={r}
          depth={Math.min(depth + 1, 2)}
          onReply={onReply}
          activeReply={activeReply}
        />
      ))}
    </div>
  );
}

/** Comments arrive nested, so a flat length would only count the top level. */
function countThread(comments: Comment[]): number {
  return comments.reduce((n, c) => n + 1 + countThread(c.replies ?? []), 0);
}

/**
 * The wiki, which the portal did not have at all (CMN-06).
 *
 * Collections and pages shipped with CMN-01 and only organisers could reach
 * them — so a co-op's handbook, bylaws and how-to pages were written for
 * members and visible only to admins. Read-only here on purpose: authoring is
 * an ADMIN route, and offering an edit box that the API refuses is worse than
 * offering none.
 */
function LibrarySection() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [page, setPage] = useState<CollectionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!org || !token) { setLoading(false); return; }
    api.commons
      .listCollections(org.id, token)
      .then(setCollections)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load the library'),
      )
      .finally(() => setLoading(false));
  }, [org, token]);

  async function openPage(pageId: string) {
    if (!org || !token) return;
    setError('');
    try {
      setPage(await api.commons.getPage(org.id, pageId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that page');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (page) {
    return (
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <button
          onClick={() => setPage(null)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <ChevronLeft className="h-4 w-4" /> Back to the library
        </button>
        <article className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">{page.title}</h2>
          <p className="mt-1 text-xs text-gray-400">
            Updated {new Date(page.updatedAt).toLocaleDateString()}
            {page.author?.name ? ` by ${page.author.name}` : ''}
          </p>
          {/*
            Page bodies are HTML. Rendered as text they show `<p>` tags;
            rendered raw they run whoever wrote them in every member's
            browser. Sanitised is the only option that is neither.
          */}
          <div
            className="prose prose-sm mt-4 max-w-none text-sm leading-relaxed text-gray-700"
            dangerouslySetInnerHTML={{ __html: sanitizeWikiHtml(page.body) }}
          />
        </article>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <>
        {error && <ErrorNote message={error} />}
        <p className="py-8 text-center text-sm text-gray-500">
          Nothing in the library yet.
        </p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      {collections.map((c) => (
        <section key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span aria-hidden>{c.emoji || '📄'}</span>
            {c.name}
          </h2>
          {c.description && <p className="mt-0.5 text-xs text-gray-500">{c.description}</p>}
          {c.pages?.length ? (
            <ul className="mt-3 space-y-1">
              {c.pages.map((pg) => (
                <li key={pg.id}>
                  <button
                    onClick={() => openPage(pg.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    {pg.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-gray-400">No pages in here yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** One place the whole page reports a failure, rather than three silences. */
function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

/**
 * How a co-op decides things (CMN-10).
 *
 * The mechanism was complete and the way in was not: proposals, votes, quorum,
 * closing dates and an outcome computed from them all existed, and no member
 * could raise one. The record was missing too — the schema carries PASSED and
 * FAILED, and the page printed those words raw, so "we voted on this in March
 * and adopted it" lived nowhere the co-op could point at.
 *
 * Three groups rather than one list, because they answer different questions:
 * what needs my vote, what is waiting to be opened, and what did we decide.
 */

/** What each status means to a co-op, rather than to the database. */
const PROPOSAL_STATES: Record<string, { label: string; tone: string; note?: string }> = {
  OPEN: { label: 'Open for voting', tone: 'bg-green-50 text-green-700' },
  DRAFT: {
    label: 'Raised',
    tone: 'bg-amber-50 text-amber-700',
    note: 'Waiting for an organiser to open voting.',
  },
  PASSED: { label: 'Adopted', tone: 'bg-green-50 text-green-800' },
  FAILED: { label: 'Lacked support', tone: 'bg-gray-100 text-gray-600' },
  CLOSED: { label: 'Closed', tone: 'bg-gray-100 text-gray-600' },
};

function ProposalsSection() {
  const { org } = usePortal();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);
  // Voting used to `catch {}`: a failed vote left the buttons exactly as they
  // were, so a member had every reason to believe it had counted.
  const [error, setError] = useState('');

  const [raising, setRaising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', channelId: '', quorum: '', closesAt: '' });

  const isOrganiser = ['ADMIN', 'STAFF'].includes(
    user?.orgs?.find((o) => o.orgId === org?.id)?.role ?? '',
  );

  const reload = useCallback(async () => {
    if (!org || !token) { setLoading(false); return; }
    try {
      setProposals(await api.commons.listProposals(org.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load proposals');
    } finally {
      setLoading(false);
    }
  }, [org, token]);

  useEffect(() => { reload(); }, [reload]);

  // A proposal lives in a channel, so raising one needs somewhere to put it.
  useEffect(() => {
    if (!org || !token) return;
    api.commons.listChannels(org.id, token).then(setChannels).catch(() => setChannels([]));
  }, [org, token]);

  async function handleVote(proposalId: string, choice: string) {
    if (!org || !token) return;
    setVotingId(proposalId);
    setError('');
    try {
      await api.commons.vote(org.id, proposalId, choice, token);
      const updated = await api.commons.getProposal(org.id, proposalId, token);
      setProposals((prev) => prev.map((p) => (p.id === proposalId ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your vote was not recorded');
    } finally {
      setVotingId(null);
    }
  }

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const openProposals = proposals.filter((p) => p.status === 'OPEN');
  const raised = proposals.filter((p) => p.status === 'DRAFT');
  const decided = proposals.filter((p) => ['PASSED', 'FAILED', 'CLOSED'].includes(p.status));

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Anyone can raise a proposal. An organiser opens it for voting, and closing it records what
          the co-op decided.
        </p>
        {channels.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setRaising(!raising);
              setDraft({ title: '', body: '', channelId: channels[0]?.id ?? '', quorum: '', closesAt: '' });
            }}
            className="btn-primary shrink-0 text-sm"
          >
            {raising ? 'Cancel' : 'Raise a proposal'}
          </button>
        )}
      </div>

      {raising && (
        <form
          className="space-y-3 rounded-xl border border-gray-200 bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!org || !token || !draft.title.trim() || !draft.channelId) return;
            act(async () => {
              await api.commons.createProposal(
                org.id,
                draft.channelId,
                {
                  title: draft.title.trim(),
                  body: draft.body.trim(),
                  ...(draft.quorum ? { quorum: parseInt(draft.quorum, 10) } : {}),
                  ...(draft.closesAt ? { closesAt: new Date(draft.closesAt).toISOString() } : {}),
                },
                token,
              );
              setRaising(false);
            });
          }}
        >
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Buy a second kiln"
            className="input w-full"
            aria-label="Proposal title"
            autoFocus
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="What you are proposing, and why."
            rows={5}
            className="input w-full"
            aria-label="Proposal detail"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">Channel</span>
              <select
                value={draft.channelId}
                onChange={(e) => setDraft({ ...draft, channelId: e.target.value })}
                className="input w-full"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {/* Optional on purpose: a co-op that has not agreed a quorum
                  should not have to invent one to ask a question. */}
              <span className="mb-1 block text-gray-700">Quorum (optional)</span>
              <input
                type="number"
                min={1}
                value={draft.quorum}
                onChange={(e) => setDraft({ ...draft, quorum: e.target.value })}
                placeholder="e.g. 10"
                className="input w-full"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">Closes (optional)</span>
              <input
                type="date"
                value={draft.closesAt}
                onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                className="input w-full"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Raising it does not start the vote — an organiser opens it when the co-op is ready.
          </p>
          <button type="submit" disabled={busy} className="btn-primary text-sm">
            {busy ? 'Raising...' : 'Raise proposal'}
          </button>
        </form>
      )}

      <ProposalGroup
        title="Open for voting"
        empty="Nothing to vote on right now."
        proposals={openProposals}
        onVote={handleVote}
        votingId={votingId}
        isOrganiser={isOrganiser}
        busy={busy}
        onClose={(id) => { if (org && token) act(() => api.commons.closeProposal(org.id, id, token)); }}
      />

      {raised.length > 0 && (
        <ProposalGroup
          title="Raised"
          empty=""
          proposals={raised}
          isOrganiser={isOrganiser}
          busy={busy}
          onOpen={(id) => { if (org && token) act(() => api.commons.openProposal(org.id, id, token)); }}
        />
      )}

      {decided.length > 0 && (
        <ProposalGroup
          title="Decided"
          empty=""
          proposals={decided}
          isOrganiser={isOrganiser}
          busy={busy}
        />
      )}
    </div>
  );
}

function ProposalGroup({
  title,
  empty,
  proposals,
  onVote,
  votingId,
  isOrganiser,
  busy,
  onOpen,
  onClose,
}: {
  title: string;
  empty: string;
  proposals: Proposal[];
  onVote?: (id: string, choice: string) => void;
  votingId?: string | null;
  isOrganiser: boolean;
  busy: boolean;
  onOpen?: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{title}</h3>

      {proposals.length === 0 ? (
        empty ? <p className="text-sm text-gray-500">{empty}</p> : null
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => {
            const state = PROPOSAL_STATES[proposal.status] ?? {
              label: proposal.status,
              tone: 'bg-gray-100 text-gray-600',
            };
            const total = proposal.voteTally?.total || 0;
            const yes = proposal.voteTally?.yes || 0;
            const yesPercent = total > 0 ? Math.round((yes / total) * 100) : 0;

            return (
              <div key={proposal.id} className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-gray-900">{proposal.title}</h4>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${state.tone}`}>
                      {state.label}
                    </span>
                    {state.note && <p className="mt-1 text-xs text-gray-500">{state.note}</p>}
                  </div>

                  {isOrganiser && (
                    <div className="flex shrink-0 gap-3 text-sm">
                      {proposal.status === 'DRAFT' && onOpen && (
                        <button
                          type="button"
                          onClick={() => onOpen(proposal.id)}
                          disabled={busy}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Open voting
                        </button>
                      )}
                      {proposal.status === 'OPEN' && onClose && (
                        <button
                          type="button"
                          onClick={() => onClose(proposal.id)}
                          disabled={busy}
                          className="font-medium text-gray-600 hover:underline"
                        >
                          Close &amp; record
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {proposal.body && <p className="mt-2 text-sm text-gray-600">{proposal.body}</p>}

                {total > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-gray-200">
                      <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${yesPercent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {yes} in favour of {total} {total === 1 ? 'vote' : 'votes'}
                      {proposal.quorum ? ` · quorum ${proposal.quorum}` : ''}
                    </p>
                  </div>
                )}

                {proposal.status === 'OPEN' && onVote && (
                  <div className="mt-3 flex gap-2">
                    {(['YES', 'NO', 'ABSTAIN'] as const).map((choice) => (
                      <button
                        key={choice}
                        onClick={() => onVote(proposal.id, choice)}
                        disabled={votingId === proposal.id}
                        className="btn-secondary text-xs"
                      >
                        {choice === 'YES' ? 'In favour' : choice === 'NO' ? 'Against' : 'Abstain'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
