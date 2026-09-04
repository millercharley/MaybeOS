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
  BookOpen,
  ChevronDown,
  ChevronRight,
  Send,
  Users,
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { api, Comment as CommentT, Post, PaginatedResponse, CollectionPage, DirectMessage } from '@/lib/api';
import { sanitizeWikiHtml } from '@/lib/wiki-html';
import { renderBodyHtml, isBlankBody, asRichBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { PageHeader } from '@/components/layout/page-header';

type View =
  | { type: 'channel'; id: string }
  | { type: 'page'; id: string }
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
    const pageId = searchParams.get('page');
    if (channelId) setView({ type: 'channel', id: channelId });
    else if (pageId) setView({ type: 'page', id: pageId });
     
  }, [searchParams]);
  const [openCollections, setOpenCollections] = useState<Record<string, boolean>>({});

  // ── Writing the Library (CMN-09) ────────────────────────────────
  //
  // The API for this has existed since the wiki was built — create, update,
  // delete, for collections and pages alike — and nothing in the product
  // called it, so a co-op could read a library it had no way to write. Charley
  // found it looking for where MaybeItsFate's Member Handbook would live.
  const [newCollection, setNewCollection] = useState<{ name: string; emoji: string } | null>(null);
  const [newPageIn, setNewPageIn] = useState<string | null>(null);
  const [pageDraft, setPageDraft] = useState({ title: '', body: '' });
  const [editingPage, setEditingPage] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState('');

  async function withLibrary(work: () => Promise<unknown>) {
    setLibraryBusy(true);
    setLibraryError('');
    try {
      await work();
      await refetchCollections();
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setLibraryBusy(false);
    }
  }

  /**
   * Move a page within its collection.
   *
   * Swaps the two `sortOrder` values rather than renumbering the list: a
   * handbook is a sequence somebody curated, and rewriting every row to move
   * one item is how a concurrent edit loses the rest of the order.
   */
  async function movePage(collectionId: string, pageId: string, direction: -1 | 1) {
    const collection = (collections ?? []).find((c) => c.id === collectionId);
    if (!collection || !token || !currentOrgId) return;

    const pages = [...collection.pages].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const index = pages.findIndex((p) => p.id === pageId);
    const swapWith = pages[index + direction];
    if (index === -1 || !swapWith) return;

    await withLibrary(async () => {
      await api.commons.updatePage(currentOrgId, pageId, { sortOrder: swapWith.sortOrder ?? 0 }, token);
      await api.commons.updatePage(currentOrgId, swapWith.id, { sortOrder: pages[index].sortOrder ?? 0 }, token);
    });
  }
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [newPostBody, setNewPostBody] = useState('');
  const [dmDraft, setDmDraft] = useState('');
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const { data: channels, loading: channelsLoading, error: channelsError, refetch: refetchChannels } = useApi(
    (token, orgId) => api.commons.listChannels(orgId, token),
    [],
  );

  const { data: collections, refetch: refetchCollections } = useApi(
    (token, orgId) => api.commons.listCollections(orgId, token),
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

  const { data: pageContent, loading: pageLoading, refetch: refetchPage } = useApi<CollectionPage | null>(
    (token, orgId) => {
      if (view?.type !== 'page') return Promise.resolve(null);
      return api.commons.getPage(orgId, view.id, token);
    },
    [view?.type === 'page' ? view.id : null],
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
        {/* Left rail: Collections, Channels, People */}
        <div className="w-full shrink-0 space-y-4 lg:w-60">
          {/* Collections */}
          <div className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Collections</h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setNewCollection(newCollection ? null : { name: '', emoji: '📘' })}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  {newCollection ? 'Cancel' : 'New'}
                </button>
              )}
            </div>

            {libraryError && (
              <p className="mb-2 text-xs text-red-600" role="alert">{libraryError}</p>
            )}

            {newCollection && (
              <form
                className="mb-3 space-y-2 rounded-md border border-gray-200 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!token || !currentOrgId || !newCollection.name.trim()) return;
                  withLibrary(async () => {
                    await api.commons.createCollection(
                      currentOrgId,
                      { name: newCollection.name.trim(), emoji: newCollection.emoji || '📘' },
                      token,
                    );
                    setNewCollection(null);
                  });
                }}
              >
                <div className="flex gap-2">
                  <input
                    value={newCollection.emoji}
                    onChange={(e) => setNewCollection({ ...newCollection, emoji: e.target.value })}
                    className="input w-14 text-center"
                    aria-label="Emoji"
                    maxLength={4}
                  />
                  <input
                    value={newCollection.name}
                    onChange={(e) => setNewCollection({ ...newCollection, name: e.target.value })}
                    placeholder="Member Handbook"
                    className="input flex-1 text-sm"
                    aria-label="Collection name"
                    autoFocus
                  />
                </div>
                <button type="submit" disabled={libraryBusy} className="btn-primary w-full text-xs">
                  {libraryBusy ? 'Adding...' : 'Add collection'}
                </button>
              </form>
            )}

            <ul className="space-y-1">
              {(collections ?? []).map((collection) => {
                const isOpen = openCollections[collection.id] ?? false;
                return (
                  <li key={collection.id}>
                    <button
                      onClick={() => setOpenCollections((s) => ({ ...s, [collection.id]: !isOpen }))}
                      className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                      <span>{collection.emoji}</span>
                      <span className="truncate">{collection.name}</span>
                    </button>
                    {isOpen && (
                      <ul className="ml-6 space-y-0.5">
                        {collection.pages.map((page, pageIndex) => (
                          <li key={page.id}>
                            <button
                              onClick={() => setView({ type: 'page', id: page.id })}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                                view?.type === 'page' && view.id === page.id
                                  ? 'bg-brand-50 text-brand-700 font-medium'
                                  : 'text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              <BookOpen className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{page.title}</span>
                            </button>
                            {isAdmin && (
                              <div className="ml-6 flex gap-2 pb-1">
                                {/* Order is the point of a handbook: "0. You
                                    BELONG" before "1. Code of Conduct". */}
                                <button
                                  type="button"
                                  onClick={() => movePage(collection.id, page.id, -1)}
                                  disabled={libraryBusy || pageIndex === 0}
                                  className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                                >
                                  Move up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => movePage(collection.id, page.id, 1)}
                                  disabled={libraryBusy || pageIndex === collection.pages.length - 1}
                                  className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                                >
                                  Move down
                                </button>
                              </div>
                            )}
                          </li>
                        ))}

                        {isAdmin && (
                          <li className="pt-1">
                            {newPageIn === collection.id ? (
                              <form
                                className="space-y-2 rounded-md border border-gray-200 p-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  if (!token || !currentOrgId || !pageDraft.title.trim()) return;
                                  withLibrary(async () => {
                                    const created = await api.commons.createPage(
                                      currentOrgId,
                                      collection.id,
                                      { title: pageDraft.title.trim(), body: pageDraft.body },
                                      token,
                                    );
                                    setNewPageIn(null);
                                    setPageDraft({ title: '', body: '' });
                                    setView({ type: 'page', id: created.id });
                                  });
                                }}
                              >
                                <input
                                  value={pageDraft.title}
                                  onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })}
                                  placeholder="0. You BELONG"
                                  className="input w-full text-sm"
                                  aria-label="Page title"
                                  autoFocus
                                />
                                <button type="submit" disabled={libraryBusy} className="btn-primary w-full text-xs">
                                  {libraryBusy ? 'Adding...' : 'Add page'}
                                </button>
                              </form>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setNewPageIn(collection.id);
                                  setPageDraft({ title: '', body: '' });
                                }}
                                className="px-2 text-xs font-medium text-brand-600 hover:underline"
                              >
                                + Add page
                              </button>
                            )}
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
              {(collections ?? []).length === 0 && (
                <li className="px-2 py-1 text-xs text-gray-400">No collections yet.</li>
              )}
            </ul>
          </div>

          {/* Channels */}
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Channels</h2>
            <ul className="space-y-1">
              {channelList.map((channel) => (
                <li key={channel.id} className="group flex items-center">
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
                  {isAdmin && (
                    <button
                      onClick={() => handleTogglePin(channel.id, channel.isPinned)}
                      className="ml-1 hidden shrink-0 text-gray-300 hover:text-gray-600 group-hover:block"
                      title={channel.isPinned ? 'Unpin' : 'Pin'}
                    >
                      {channel.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
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
          {view?.type === 'page' ? (
            pageLoading || !pageContent ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
              </div>
            ) : (
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-xl font-semibold text-gray-900">{pageContent.title}</h2>
                  {isAdmin && !editingPage && (
                    <div className="flex shrink-0 gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() => {
                          setPageDraft({ title: pageContent.title, body: pageContent.body });
                          setEditingPage(true);
                        }}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!token || !currentOrgId) return;
                          // Deleting a handbook page removes something members
                          // are pointed at on their first day, so it asks.
                          if (!window.confirm(`Delete "${pageContent.title}"? This cannot be undone.`)) return;
                          withLibrary(async () => {
                            await api.commons.deletePage(currentOrgId, pageContent.id, token);
                            setView(null);
                          });
                        }}
                        className="text-gray-500 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {editingPage ? (
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!token || !currentOrgId) return;
                      withLibrary(async () => {
                        await api.commons.updatePage(
                          currentOrgId,
                          pageContent.id,
                          { title: pageDraft.title.trim(), body: pageDraft.body },
                          token,
                        );
                        setEditingPage(false);
                        await refetchPage();
                      });
                    }}
                  >
                    <input
                      value={pageDraft.title}
                      onChange={(e) => setPageDraft({ ...pageDraft, title: e.target.value })}
                      className="input w-full"
                      aria-label="Page title"
                    />
                    <textarea
                      value={pageDraft.body}
                      onChange={(e) => setPageDraft({ ...pageDraft, body: e.target.value })}
                      rows={18}
                      className="input w-full font-mono text-sm"
                      aria-label="Page body"
                    />
                    {/* Said plainly, because the field takes HTML and the
                        renderer sanitises it — a co-op pasting a stray tag
                        should know why it vanished rather than think the save
                        failed. */}
                    <p className="text-xs text-gray-500">
                      Basic HTML is allowed — headings, paragraphs, lists, links and emphasis. Anything
                      else is stripped when the page is shown.
                    </p>
                    <div className="flex gap-3">
                      <button type="submit" disabled={libraryBusy} className="btn-primary text-sm">
                        {libraryBusy ? 'Saving...' : 'Save page'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPage(false)}
                        className="text-sm text-gray-500 hover:text-gray-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    className="prose prose-sm mt-4 max-w-none text-gray-700"
                    dangerouslySetInnerHTML={{ __html: sanitizeWikiHtml(pageContent.body) }}
                  />
                )}
              </div>
            )
          ) : view?.type === 'dm' ? (
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
