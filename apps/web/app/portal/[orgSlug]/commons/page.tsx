'use client';

import { useState, useEffect, FormEvent } from 'react';
import {
  MessageSquare, ThumbsUp, ThumbsDown, Minus, Send, Pin, BookOpen, ChevronLeft,
} from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Channel, Post, Proposal, Collection, CollectionPage, Comment } from '@/lib/api';
import { sanitizeWikiHtml } from '@/lib/wiki-html';

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

  async function handlePost(e: FormEvent) {
    e.preventDefault();
    if (!org || !token || !selectedChannel || !newPost.trim()) return;
    setPosting(true);
    setError('');
    try {
      const post = await api.commons.createPost(org.id, selectedChannel, { body: newPost }, token);
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
        <form onSubmit={handlePost} className="flex gap-2">
          <input
            type="text"
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            placeholder="Write a message..."
            className="input flex-1"
          />
          <button type="submit" disabled={posting || !newPost.trim()} className="btn-primary">
            <Send className="h-4 w-4" />
          </button>
        </form>

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

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.commons.addComment(orgId, post.id, {
        body: draft.trim(),
        ...(replyTo ? { parentId: replyTo } : {}),
      }, token);
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
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{post.body}</p>

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

          <form onSubmit={submitComment} className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={replyTo ? 'Write a reply...' : 'Add a comment...'}
              className="input flex-1 text-sm"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="btn-primary text-sm">
              {busy ? '...' : 'Send'}
            </button>
          </form>
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
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{comment.body}</p>
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

function ProposalsSection() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);
  // Voting used to `catch {}`: a failed vote left the buttons exactly as they
  // were, so a member had every reason to believe it had counted.
  const [error, setError] = useState('');

  useEffect(() => {
    if (!org || !token) { setLoading(false); return; }
    api.commons
      .listProposals(org.id, token)
      .then(setProposals)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load proposals'),
      )
      .finally(() => setLoading(false));
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
      setError(err instanceof Error ? err.message : 'Your vote did not go through');
    }
    setVotingId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <>
        {error && <ErrorNote message={error} />}
        <p className="py-8 text-center text-sm text-gray-500">No proposals yet.</p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      {proposals.map((proposal) => {
        const total = proposal.voteTally?.total || 0;
        const yesPercent = total > 0 ? Math.round(((proposal.voteTally?.yes || 0) / total) * 100) : 0;

        return (
          <div key={proposal.id} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{proposal.title}</h3>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    proposal.status === 'OPEN'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {proposal.status}
                </span>
              </div>
            </div>
            <p className="mt-2 text-sm text-gray-600">{proposal.body}</p>

            {total > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Yes: {proposal.voteTally?.yes}</span>
                  <span>No: {proposal.voteTally?.no}</span>
                  <span>Abstain: {proposal.voteTally?.abstain}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-green-500"
                    style={{ width: `${yesPercent}%` }}
                  />
                </div>
              </div>
            )}

            {proposal.status === 'OPEN' && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleVote(proposal.id, 'YES')}
                  disabled={votingId === proposal.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100"
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Yes
                </button>
                <button
                  onClick={() => handleVote(proposal.id, 'NO')}
                  disabled={votingId === proposal.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> No
                </button>
                <button
                  onClick={() => handleVote(proposal.id, 'ABSTAIN')}
                  disabled={votingId === proposal.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  <Minus className="h-3.5 w-3.5" /> Abstain
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
