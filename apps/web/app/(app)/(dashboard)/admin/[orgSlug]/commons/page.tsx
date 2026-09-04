'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  MessageSquare,
  Hash,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Pin,
  PinOff,
  Send,
  Users,
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { api, Comment as CommentT, Post, PaginatedResponse, DirectMessage } from '@/lib/api';
import { renderBodyHtml, isBlankBody, asRichBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { PageHeader } from '@/components/layout/page-header';

type View =
  | { type: 'channel'; id: string }
  | { type: 'dm'; userId: string; name?: string };

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '😂'];

function timeAgo(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CommentThread({
  comment,
  depth,
  onReply,
  onEdit,
  viewerId,
}: {
  comment: CommentT;
  depth: number;
  onReply: (parentId: string, body: string) => void;
  onEdit: (commentId: string, body: string) => Promise<void>;
  /** Who is reading, so the edit is offered only on their own words. */
  viewerId?: string;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  // Authorship, not rank — an organiser gets no edit on somebody else's
  // comment here either. The API refuses it regardless of role; this is only
  // whether to offer the button.
  const isAuthor = Boolean(viewerId && comment.author?.id === viewerId);

  async function saveEdit() {
    if (isBlankBody(editDraft)) return;
    setEditBusy(true);
    setEditError('');
    try {
      await onEdit(comment.id, asRichBody(editDraft));
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save that edit');
    }
    setEditBusy(false);
  }

  return (
    <div style={{ marginLeft: depth > 0 ? 24 : 0 }} className="mt-3">
      <div className="flex gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
          {(comment.author.name ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-900">{comment.author.name ?? 'Unknown'}</span>
              <span className="text-[11px] text-gray-400">{timeAgo(comment.createdAt)}</span>
              {comment.editedAt && (
                <span
                  className="text-[11px] text-gray-400"
                  title={new Date(comment.editedAt).toLocaleString()}
                >
                  · edited
                </span>
              )}
            </div>
            {editing ? (
              <div className="mt-1 space-y-2">
                {editError && <p className="text-[11px] text-red-600">{editError}</p>}
                {/* The same composer the portal edits with. A plain textarea
                    here would have stripped the formatting off any comment
                    written on the other page — an edit that silently throws
                    away part of what somebody wrote. */}
                <RichComposer
                  value={editDraft}
                  onChange={setEditDraft}
                  onSubmit={saveEdit}
                  placeholder="Edit your comment..."
                  submitLabel={editBusy ? 'Saving...' : 'Save'}
                  busy={editBusy}
                  rows={2}
                />
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                className="prose prose-sm mt-0.5 max-w-none whitespace-pre-wrap text-sm text-gray-700"
                dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
              />
            )}
          </div>
          {!editing && (
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => setReplying((r) => !r)}
                className="text-xs font-medium text-gray-400 hover:text-brand-600"
              >
                Reply
              </button>
              {isAuthor && (
                <button
                  onClick={() => {
                    // The rendered HTML, not the raw column: a body written
                    // before the rich composer existed is plain text, and
                    // putting it into a contentEditable unescaped would let
                    // its own characters become markup.
                    setEditDraft(renderBodyHtml(comment.body));
                    setEditError('');
                    setEditing(true);
                  }}
                  className="text-xs font-medium text-gray-400 hover:text-brand-600"
                >
                  Edit
                </button>
              )}
            </div>
          )}

          {replying && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    onReply(comment.id, draft.trim());
                    setDraft('');
                    setReplying(false);
                  }
                }}
                placeholder={`Reply to ${comment.author.name ?? 'this'}...`}
                className="input flex-1 text-sm"
              />
              <button
                onClick={() => {
                  if (draft.trim()) {
                    onReply(comment.id, draft.trim());
                    setDraft('');
                    setReplying(false);
                  }
                }}
                className="btn-secondary px-3"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {comment.replies?.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              onEdit={onEdit}
              viewerId={viewerId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CommonsPage() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isAdmin = user?.orgs.find((o) => o.orgId === currentOrgId)?.role === 'ADMIN';

  const searchParams = useSearchParams();
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    const channelId = searchParams.get('channel');
    if (channelId) setView({ type: 'channel', id: channelId });
     
  }, [searchParams]);
  // Arranging the Commons (CMN-10). Up here with the rest of the page's
  // state, because everything below `if (!token) return null` is past an
  // early return and a hook cannot live there.
  const [managing, setManaging] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState('');

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [newPostBody, setNewPostBody] = useState('');
  const [dmDraft, setDmDraft] = useState('');
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const { data: channels, loading: channelsLoading, error: channelsError, refetch: refetchChannels } = useApi(
    (token, orgId) => api.commons.listChannels(orgId, token),
    [],
  );

  const { data: conversations, refetch: refetchConversations } = useApi(
    (token, orgId) => api.commons.listConversations(orgId, token),
    [],
  );

  const { data: members } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 100),
    [],
  );

  const { data: proposals, loading: proposalsLoading } = useApi(
    (token, orgId) => api.commons.listProposals(orgId, token),
    [],
  );

  const activeChannelId = view?.type === 'channel' ? view.id : (channels?.[0]?.id ?? null);

  const { data: postsData, loading: postsLoading, refetch: refetchPosts } = useApi<PaginatedResponse<Post>>(
    (token, orgId) => {
      if (!activeChannelId) {
        return Promise.resolve({ data: [], meta: { page: 1, perPage: 25, total: 0, totalPages: 0 } });
      }
      return api.commons.listPosts(orgId, activeChannelId, token);
    },
    [activeChannelId],
  );

  const { data: expandedPost, refetch: refetchExpandedPost } = useApi<Post | null>(
    (token, orgId) => {
      if (!expandedPostId) return Promise.resolve(null);
      return api.commons.getPost(orgId, expandedPostId, token);
    },
    [expandedPostId],
  );

  const { data: dmMessages, refetch: refetchDm } = useApi<DirectMessage[]>(
    (token, orgId) => {
      if (view?.type !== 'dm') return Promise.resolve([]);
      return api.commons.getConversation(orgId, view.userId, token);
    },
    [view?.type === 'dm' ? view.userId : null],
  );

  if (!token || !currentOrgId) return null;

  const channelList = channels ?? [];
  const selectedChannel = channelList.find((c) => c.id === activeChannelId);
  const posts = postsData?.data ?? [];
  const proposalList = proposals ?? [];

  async function handleCreatePost() {
    if (!newPostBody.trim() || !activeChannelId) return;
    await api.commons.createPost(currentOrgId!, activeChannelId, { body: newPostBody.trim() }, token!);
    setNewPostBody('');
    refetchPosts();
  }

  async function handleReact(postId: string, emoji: string) {
    await api.commons.addReaction(currentOrgId!, postId, emoji, token!);
    refetchPosts();
    if (expandedPostId === postId) refetchExpandedPost();
  }

  async function handleEditComment(commentId: string, body: string) {
    await api.commons.editComment(currentOrgId!, commentId, body, token!);
    refetchExpandedPost();
  }

  async function handleReply(postId: string, parentId: string | undefined, body: string) {
    await api.commons.addComment(currentOrgId!, postId, { body, parentId }, token!);
    refetchExpandedPost();
    refetchPosts();
  }

  // ── Arranging the Commons (CMN-10) ──────────────────────────────
  //
  // Creating a channel has been an ADMIN endpoint since CommonsOS was built
  // and nothing in the product ever called it — so every co-op had exactly the
  // channels its seed gave it, and no way to add, rename, order or remove one.
  async function withChannels(work: () => Promise<unknown>) {
    setChannelBusy(true);
    setChannelError('');
    try {
      await work();
      await refetchChannels();
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setChannelBusy(false);
    }
  }

  async function handleCreateChannel() {
    const name = newChannelName.trim();
    if (!name) return;
    await withChannels(async () => {
      await api.commons.createChannel(currentOrgId!, { name }, token!);
      setNewChannelName('');
    });
  }

  async function handleRenameChannel(channelId: string) {
    const name = renameDraft.trim();
    if (!name) return;
    await withChannels(async () => {
      await api.commons.updateChannel(currentOrgId!, channelId, { name }, token!);
      setRenaming(null);
    });
  }

  /**
   * Move one channel, by sending the whole order.
   *
   * The list on screen is already sorted the way the API sorts it, so moving
   * an item here and posting the result is the same order the server will
   * compute — no second sort to disagree with the first.
   *
   * Pinned channels sort above unpinned ones regardless of position, so this
   * reorders within the list as displayed and lets the server's pin rule win.
   * Dragging a pinned channel below an unpinned one and watching it spring
   * back would be confusing, which is why pinning is its own visible control.
   */
  async function handleMoveChannel(channelId: string, direction: -1 | 1) {
    const ids = channelList.map((c) => c.id);
    const index = ids.indexOf(channelId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;

    [ids[index], ids[target]] = [ids[target], ids[index]];
    await withChannels(() => api.commons.reorderChannels(currentOrgId!, ids, token!));
  }

  async function handleDeleteChannel(channelId: string, name: string, posts: number) {
    // Said in numbers, because a channel is where the conversation lives and
    // deleting it takes every post and comment in it.
    const warning = posts
      ? `Delete #${name} and the ${posts} ${posts === 1 ? 'post' : 'posts'} in it? This cannot be undone.`
      : `Delete #${name}? This cannot be undone.`;
    if (!window.confirm(warning)) return;

    await withChannels(async () => {
      await api.commons.deleteChannel(currentOrgId!, channelId, token!);
      setView(null);
    });
  }

  async function handleTogglePin(channelId: string, isPinned: boolean) {
    await api.commons.pinChannel(currentOrgId!, channelId, !isPinned, token!);
    refetchChannels();
  }

  async function handleSendDm() {
    if (!dmDraft.trim() || view?.type !== 'dm') return;
    await api.commons.sendMessage(currentOrgId!, view.userId, dmDraft.trim(), token!);
    setDmDraft('');
    refetchDm();
    refetchConversations();
  }

  if (channelsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (channelsError) {
    return <div className="py-12 text-center text-sm text-red-600">Failed to load channels: {channelsError}</div>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Commons"
      />{/* Stacked below `lg`, side by side above it (UI-01). A 240px rail
          beside the feed left 111px for the conversation on a 375px phone,
          and the composer ran off the screen. */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left rail: Channels, People */}
        <div className="w-full shrink-0 space-y-4 lg:w-60">
          {/* Channels */}
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Channels</h2>
              {/* One toggle rather than five controls on every row. The rail is
                  240px wide and is navigation most of the time; arranging the
                  Commons is a thing an admin does occasionally and deliberately
                  (CMN-10). */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setManaging((m) => !m);
                    setRenaming(null);
                    setChannelError('');
                  }}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  {managing ? 'Done' : 'Manage'}
                </button>
              )}
            </div>

            {channelError && (
              <p className="mb-2 text-xs text-red-600" role="alert">{channelError}</p>
            )}

            <ul className="space-y-1">
              {channelList.map((channel, index) => (
                <li key={channel.id} className="group">
                  {renaming === channel.id ? (
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenameChannel(channel.id);
                      }}
                    >
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        className="input min-w-0 flex-1 text-sm"
                        aria-label={`Rename ${channel.name}`}
                      />
                      <button type="submit" disabled={channelBusy} className="btn-primary px-2 text-xs">
                        Save
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center">
                      <button
                        onClick={() => setView({ type: 'channel', id: channel.id })}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                          view?.type === 'channel' && view.id === channel.id
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : (!view && channel.id === activeChannelId)
                              ? 'bg-brand-50 text-brand-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <Hash className="h-4 w-4 shrink-0" />
                        <span className="truncate">{channel.name}</span>
                        {channel.isPinned && <Pin className="h-3 w-3 shrink-0 text-gray-400" />}
                      </button>
                      {isAdmin && !managing && (
                        <button
                          onClick={() => handleTogglePin(channel.id, channel.isPinned)}
                          className="ml-1 hidden shrink-0 text-gray-300 hover:text-gray-600 group-hover:block"
                          title={channel.isPinned ? 'Unpin' : 'Pin'}
                        >
                          {channel.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  )}

                  {isAdmin && managing && renaming !== channel.id && (
                    <div className="ml-2 flex flex-wrap items-center gap-2 pb-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveChannel(channel.id, -1)}
                        disabled={channelBusy || index === 0}
                        className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveChannel(channel.id, 1)}
                        disabled={channelBusy || index === channelList.length - 1}
                        className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameDraft(channel.name);
                          setRenaming(channel.id);
                        }}
                        className="text-[11px] text-gray-400 hover:text-gray-700"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePin(channel.id, channel.isPinned)}
                        disabled={channelBusy}
                        className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                      >
                        {channel.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                      {/* The default channel has no Delete, because the API
                          refuses it — offering a button that always fails is
                          worse than not offering one. */}
                      {!channel.isDefault && (
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteChannel(channel.id, channel.name, channel._count?.posts ?? 0)
                          }
                          disabled={channelBusy}
                          className="text-[11px] text-gray-400 hover:text-red-600 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {isAdmin && managing && (
              <form
                className="mt-3 flex gap-1 border-t border-gray-100 pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateChannel();
                }}
              >
                <input
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="New channel"
                  className="input min-w-0 flex-1 text-sm"
                  aria-label="New channel name"
                />
                <button
                  type="submit"
                  disabled={channelBusy || !newChannelName.trim()}
                  className="btn-primary px-2 text-xs disabled:opacity-50"
                >
                  {channelBusy ? '...' : 'Add'}
                </button>
              </form>
            )}
          </div>

          {/* People / DMs */}
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">People</h2>
              <button onClick={() => setShowMemberPicker((s) => !s)} className="text-gray-400 hover:text-brand-600">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-1">
              {(conversations ?? []).map((conv) => (
                <li key={conv.counterpart.id}>
                  <button
                    onClick={() => setView({ type: 'dm', userId: conv.counterpart.id, name: conv.counterpart.name })}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                      view?.type === 'dm' && view.userId === conv.counterpart.id
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="truncate">{conv.counterpart.name ?? 'Unknown'}</span>
                    {conv.unreadCount > 0 && (
                      <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {(conversations ?? []).length === 0 && !showMemberPicker && (
                <li className="px-2 py-1 text-xs text-gray-400">No conversations yet.</li>
              )}
            </ul>
            {showMemberPicker && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto border-t border-gray-100 pt-2">
                {(members?.data ?? [])
                  .filter((m) => m.user.id !== user?.id)
                  .map((m) => (
                    <li key={m.user.id}>
                      <button
                        onClick={() => {
                          setView({ type: 'dm', userId: m.user.id, name: m.user.name });
                          setShowMemberPicker(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-gray-600 hover:bg-gray-100"
                      >
                        <Users className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="truncate">{m.user.name ?? m.user.email}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        {/* Main pane */}
        <div className="flex-1 space-y-6 min-w-0">
          {view?.type === 'dm' ? (
            <div className="card flex h-[32rem] flex-col">
              <h2 className="border-b border-gray-100 pb-3 text-lg font-semibold text-gray-900">{view.name ?? 'Conversation'}</h2>
              <div className="flex-1 space-y-3 overflow-y-auto py-4">
                {(dmMessages ?? []).map((msg) => {
                  const isMine = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                          isMine ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {msg.body}
                      </div>
                    </div>
                  );
                })}
                {(dmMessages ?? []).length === 0 && (
                  <p className="py-8 text-center text-sm text-gray-400">No messages yet. Say hello!</p>
                )}
              </div>
              <div className="flex gap-2 border-t border-gray-100 pt-3">
                <input
                  value={dmDraft}
                  onChange={(e) => setDmDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendDm()}
                  placeholder="Write a message..."
                  className="input flex-1"
                />
                <button onClick={handleSendDm} className="btn-primary px-3">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedChannel ? `#${selectedChannel.name}` : 'All Posts'}
                </h2>
              </div>

              <RichComposer
                value={newPostBody}
                onChange={setNewPostBody}
                onSubmit={handleCreatePost}
                placeholder={selectedChannel ? `Post in #${selectedChannel.name}...` : 'Write something...'}
                submitLabel="Post"
              />

              {postsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
                </div>
              ) : (
                <div className="space-y-4">
                  {posts.map((post) => {
                    const authorName = post.author.name ?? 'Unknown';
                    const initial = authorName.charAt(0).toUpperCase();
                    const isExpanded = expandedPostId === post.id;
                    const reactionCounts = (post.reactions ?? []).reduce<Record<string, number>>((acc, r) => {
                      acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
                      return acc;
                    }, {});

                    return (
                      <div key={post.id} className="card">
                        <div className="flex gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
                            <span className="text-sm font-medium text-brand-700">{initial}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{authorName}</span>
                              <span className="text-xs text-gray-400">&middot;</span>
                              <span className="text-xs text-gray-400">{timeAgo(post.createdAt)}</span>
                            </div>
                            {post.title && <h3 className="mt-1 text-sm font-medium text-gray-900">{post.title}</h3>}
                            <div
                              className="prose prose-sm mt-1 max-w-none whitespace-pre-wrap text-sm text-gray-700"
                              dangerouslySetInnerHTML={{ __html: renderBodyHtml(post.body) }}
                            />

                            <div className="mt-2 flex items-center gap-3">
                              {QUICK_EMOJIS.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReact(post.id, emoji)}
                                  className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:border-brand-300 hover:text-brand-700"
                                >
                                  <span>{emoji}</span>
                                  {reactionCounts[emoji] ? <span>{reactionCounts[emoji]}</span> : null}
                                </button>
                              ))}
                              <button
                                onClick={() => setExpandedPostId(isExpanded ? null : post.id)}
                                className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                <span>{post._count?.comments ?? 0} comments</span>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="mt-3 border-t border-gray-100 pt-3">
                                {(expandedPost?.comments ?? []).map((comment) => (
                                  <CommentThread
                                    key={comment.id}
                                    comment={comment}
                                    depth={0}
                                    onReply={(parentId, body) => handleReply(post.id, parentId, body)}
                                    onEdit={handleEditComment}
                                    viewerId={user?.id}
                                  />
                                ))}
                                <div className="mt-3">
                                  <ReplyBox onSubmit={(body) => handleReply(post.id, undefined, body)} />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {posts.length === 0 && (
                    <div className="py-12 text-center text-sm text-gray-500">No posts in this channel yet.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Active Proposals */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Active Proposals</h2>
        {proposalsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {proposalList.map((proposal) => {
              const votes = proposal.voteTally ?? { yes: 0, no: 0, abstain: 0, total: 0 };
              const totalVotes = votes.yes + votes.no + votes.abstain;
              const quorum = proposal.quorum ?? 0;
              const quorumPercent = quorum > 0 ? Math.round((totalVotes / quorum) * 100) : 0;
              const yesPercent = totalVotes > 0 ? Math.round((votes.yes / totalVotes) * 100) : 0;
              const noPercent = totalVotes > 0 ? Math.round((votes.no / totalVotes) * 100) : 0;
              const abstainPercent = totalVotes > 0 ? Math.round((votes.abstain / totalVotes) * 100) : 0;

              return (
                <div key={proposal.id} className="card">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">{proposal.title}</h3>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        proposal.status === 'OPEN'
                          ? 'bg-blue-50 text-blue-700'
                          : proposal.status === 'PASSED'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {proposal.status}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ThumbsUp className="h-3.5 w-3.5 text-green-500" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-gray-100">
                          <div className="h-2 rounded-full bg-green-500" style={{ width: `${yesPercent}%` }} />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {votes.yes} ({yesPercent}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ThumbsDown className="h-3.5 w-3.5 text-red-500" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-gray-100">
                          <div className="h-2 rounded-full bg-red-500" style={{ width: `${noPercent}%` }} />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {votes.no} ({noPercent}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Minus className="h-3.5 w-3.5 text-gray-400" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-gray-100">
                          <div className="h-2 rounded-full bg-gray-400" style={{ width: `${abstainPercent}%` }} />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {votes.abstain} ({abstainPercent}%)
                      </span>
                    </div>
                  </div>

                  {quorum > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-3">
                        <span>Quorum progress</span>
                        <span>{Math.min(quorumPercent, 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(quorumPercent, 100)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {totalVotes} of {quorum} required votes
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {proposalList.length === 0 && (
              <div className="col-span-full py-12 text-center text-sm text-gray-500">No proposals found.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplyBox({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex gap-2">
      <RichComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          if (isBlankBody(draft)) return;
          onSubmit(composerValue(draft));
          setDraft('');
        }}
        placeholder="Add a comment..."
        submitLabel="Send"
        rows={2}
      />
    </div>
  );
}
