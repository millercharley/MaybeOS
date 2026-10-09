'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  MessageSquare,
  Hash,
  Pin,
  PinOff,
  Send,
  Users,
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { api, Comment as CommentT, Post, PaginatedResponse, ThreadDetail } from '@/lib/api';
import { groupChannels } from '@/lib/channel-groups';
import { renderBodyHtml, isBlankBody, asRichBody } from '@/lib/rich-text';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { EmojiPicker } from '@/components/composer/emoji-picker';
import { PageHeader } from '@/components/layout/page-header';
import { MemberName } from '@/components/member/member-name';
import { ReactionBar } from '@/components/reactions/reaction-bar';
import type { ReactionGroup } from '@/lib/reactions';
import { Modal } from '@/components/ui/modal';

/** What a dragged channel carries, so a drop can ignore anything else dragged in. */
const CHANNEL_DRAG_TYPE = 'application/x-maybeos-channel';

type View =
  | { type: 'channel'; id: string }
  | { type: 'dm'; userId: string; name?: string };

function timeAgo(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CommentThread({
  comment,
  depth,
  onReply,
  onEdit,
  onDelete,
  canDelete,
  viewerId,
}: {
  comment: CommentT;
  depth: number;
  onReply: (parentId: string, body: string) => void;
  onEdit: (commentId: string, body: string) => Promise<void>;
  /** Take this one down (CMN-18). */
  onDelete?: (comment: CommentT) => void;
  /**
   * Whether the reader may delete anybody's, rather than only their own
   * (CMN-19). An author sees the button either way.
   */
  canDelete?: boolean;
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
              <MemberName
                userId={comment.author.id}
                name={comment.author.name ?? 'Unknown'}
                className="text-xs font-semibold text-gray-900"
              />
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
              {/*
                Editing is authorship and stays with the author whatever their
                rank; deleting is the co-op removing something, and an admin
                may do it to anybody's (CMN-18).
              */}
              {(canDelete || isAuthor) && onDelete && (
                <button
                  onClick={() => onDelete(comment)}
                  className="text-xs font-medium text-gray-400 hover:text-red-600"
                >
                  Delete
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
              onDelete={onDelete}
              canDelete={canDelete}
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
  /** What is about to be taken down, and what it will take with it (CMN-18). */
  const [removing, setRemoving] = useState<
    { kind: 'post' | 'comment'; id: string; who: string; what: string } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
  // Sections: the sidebar's headings (CMN-11).
  const [newSectionName, setNewSectionName] = useState('');
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState('');
  // Dragging a channel onto a heading files it there. `dropTarget` is the
  // section id under the pointer, '' for "no section", null when none.
  const [draggingChannel, setDraggingChannel] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  /** The server's latest counts per post, so a re-render keeps them (CMN-20). */
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, ReactionGroup[]>>({});
  const [newPostBody, setNewPostBody] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [dmDraft, setDmDraft] = useState('');
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const { data: channels, loading: channelsLoading, error: channelsError, refetch: refetchChannels } = useApi(
    (token, orgId) => api.commons.listChannels(orgId, token),
    [],
  );

  const { data: sections, refetch: refetchSections } = useApi(
    (token, orgId) => api.commons.listSections(orgId, token),
    [],
  );

  // Threads, not the dormant `direct_messages` table (CMN-16). Left pointing
  // at the old one, this pane would have shown an organiser a conversation
  // list frozen on the day threads shipped.
  const { data: conversations, refetch: refetchConversations } = useApi(
    (token, orgId) => api.commons.listThreads(orgId, token),
    [],
  );

  const { data: members } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 100),
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

  const { data: openThread, refetch: refetchDm } = useApi<ThreadDetail | null>(
    (token, orgId) => {
      if (view?.type !== 'dm') return Promise.resolve(null);
      // The pane is keyed by member, so resolve that to the one-to-one
      // thread — the same call every "message this person" link makes.
      return api.commons.threadWithUser(orgId, view.userId, token);
    },
    [view?.type === 'dm' ? view.userId : null],
  );
  const dmMessages = openThread?.messages ?? [];

  /*
    Land on the newest message, the way every chat opens (CMN-15). Without
    this a channel opens scrolled to the top, showing the oldest message in
    the page — which, having just flipped the order, would be the worst of
    both arrangements.

    `postsData` rather than a length: switching channels can land on a list
    the same size as the one before it, and that would not re-run.
  */
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [postsData]);

  if (!token || !currentOrgId) return null;

  const channelList = channels ?? [];
  const sectionList = sections ?? [];
  // Admins see every heading, empty ones included, so a new section is
  // somewhere to drop a channel. Members only see headings with channels.
  const channelGroups = groupChannels(channelList, sectionList, { includeEmpty: isAdmin });
  const selectedChannel = channelList.find((c) => c.id === activeChannelId);
  const posts = postsData?.data ?? [];
  /*
    The API answers newest-first, which is right for a page that lists. A
    conversation reads the other way: oldest at the top, newest against the
    composer. Reversed here rather than asking the API for a different order,
    because "the most recent twenty" is what the page wants either way — it is
    only their order on screen that differs.
  */
  const stream = [...posts].reverse();

  async function handleCreatePost() {
    if (!newPostBody.trim() || !activeChannelId) return;
    await api.commons.createPost(currentOrgId!, activeChannelId, { body: newPostBody.trim() }, token!);
    setNewPostBody('');
    refetchPosts();
  }

  /**
   * React to a post (CMN-20).
   *
   * Hands the new counts back to `ReactionBar`, which has already drawn them
   * optimistically. It used to re-fetch the posts list *and* the open thread,
   * so pressing an emoji reloaded the conversation you were reading — with no
   * count and no sign anything had happened until it finished.
   */
  async function handleReact(postId: string, emoji: string) {
    if (!currentOrgId || !token) return null;
    try {
      const { reactions } = await api.commons.reactToPost(currentOrgId, postId, emoji, token);
      // Kept, so a re-render from somewhere else does not undo the count.
      setReactionOverrides((current) => ({ ...current, [postId]: reactions }));
      return reactions;
    } catch {
      // The bar rolls its guess back. A failed emoji is not worth a banner.
      return null;
    }
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

  /*
    Taking something down (CMN-18).

    Confirmed first and never inline: this removes somebody else's words, it
    takes their replies and attached files with it, and there is no undo. The
    dialog says which of those apply to the thing being deleted rather than
    warning in general.
  */
  async function confirmDelete() {
    if (!removing || !currentOrgId || !token) return;
    setDeleting(true);
    setDeleteError('');
    try {
      if (removing.kind === 'post') {
        await api.commons.deletePost(currentOrgId, removing.id, token);
        // It may be the post that is open. Nothing can be read from it now.
        if (expandedPostId === removing.id) setExpandedPostId(null);
      } else {
        await api.commons.deleteComment(currentOrgId, removing.id, token);
        refetchExpandedPost();
      }
      setRemoving(null);
      refetchPosts();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'That could not be deleted');
    } finally {
      setDeleting(false);
    }
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

  /** An emoji, or the section a channel files under (CMN-11). */
  async function handleChannelDetail(
    channelId: string,
    data: { emoji?: string | null; sectionId?: string | null },
  ) {
    await withChannels(async () => {
      await api.commons.updateChannel(currentOrgId!, channelId, data, token!);
      // A section's channel count feeds its Remove warning, so it has to
      // follow a channel moving in or out.
      if (data.sectionId !== undefined) await refetchSections();
    });
  }

  async function withSections(work: () => Promise<unknown>) {
    setChannelBusy(true);
    setChannelError('');
    try {
      await work();
      await refetchSections();
      // The channels carry the section they are filed under, so both lists
      // move together — otherwise deleting a heading leaves its channels
      // claiming a section that is gone until the next reload.
      await refetchChannels();
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setChannelBusy(false);
    }
  }

  async function handleCreateSection() {
    const name = newSectionName.trim();
    if (!name) return;
    await withSections(async () => {
      await api.commons.createSection(currentOrgId!, name, token!);
      setNewSectionName('');
    });
  }

  async function handleRenameSection(sectionId: string) {
    const name = sectionDraft.trim();
    if (!name) return;
    await withSections(async () => {
      await api.commons.updateSection(currentOrgId!, sectionId, name, token!);
      setRenamingSection(null);
    });
  }

  async function handleDeleteSection(sectionId: string, name: string, channelCount: number) {
    // Said plainly, because "delete" beside a list of channels reads like it
    // takes them with it. It does not — the API sets their section to null.
    const warning = channelCount
      ? `Remove the "${name}" heading? The ${channelCount} ${channelCount === 1 ? 'channel' : 'channels'} under it stay, ungrouped.`
      : `Remove the "${name}" heading?`;
    if (!window.confirm(warning)) return;

    await withSections(() => api.commons.deleteSection(currentOrgId!, sectionId, token!));
  }

  async function handleMoveSection(sectionId: string, direction: -1 | 1) {
    const ids = sectionList.map((section) => section.id);
    const index = ids.indexOf(sectionId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;

    [ids[index], ids[target]] = [ids[target], ids[index]];
    await withSections(() => api.commons.reorderSections(currentOrgId!, ids, token!));
  }

  async function handleTogglePin(channelId: string, isPinned: boolean) {
    await api.commons.pinChannel(currentOrgId!, channelId, !isPinned, token!);
    refetchChannels();
  }

  async function handleSendDm() {
    if (!dmDraft.trim() || view?.type !== 'dm' || !openThread) return;
    await api.commons.sendToThread(currentOrgId!, openThread.id, dmDraft.trim(), token!);
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

            <div className="space-y-3">
              {channelGroups.map((group) => {
                const key = group.section?.id ?? '';
                const isTarget = draggingChannel !== null && dropTarget === key;
                // The "no section" area only matters while dragging when it is
                // empty: it is where a channel goes to leave its section.
                if (!group.section && group.channels.length === 0 && draggingChannel === null) return null;

                return (
                  <div
                    key={key || 'ungrouped'}
                    onDragOver={(e) => {
                      if (!isAdmin || !e.dataTransfer.types.includes(CHANNEL_DRAG_TYPE)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTarget !== key) setDropTarget(key);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const channelId = e.dataTransfer.getData(CHANNEL_DRAG_TYPE);
                      setDropTarget(null);
                      setDraggingChannel(null);
                      const moved = channelList.find((c) => c.id === channelId);
                      if (moved && (moved.sectionId ?? '') !== key) {
                        handleChannelDetail(channelId, { sectionId: key || null });
                      }
                    }}
                    className={`rounded-md transition-colors ${isTarget ? 'bg-brand-50 ring-2 ring-brand-300' : ''}`}
                  >
                    {group.section ? (
                      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {group.section.name}
                      </h3>
                    ) : (
                      group.channels.length === 0 && (
                        <p className="px-2 py-1 text-[11px] text-gray-400">No section</p>
                      )
                    )}
                    {group.section && group.channels.length === 0 && (
                      <p className="mx-2 rounded border border-dashed border-gray-200 px-2 py-1.5 text-[11px] text-gray-400">
                        {draggingChannel ? 'Drop here' : 'Drag a channel here'}
                      </p>
                    )}
                    <ul className="space-y-1">
                      {group.channels.map((channel) => {
                        const index = channelList.indexOf(channel);
                        return (
                          <li
                            key={channel.id}
                            className={`group ${draggingChannel === channel.id ? 'opacity-50' : ''}`}
                            draggable={isAdmin && renaming !== channel.id}
                            onDragStart={(e) => {
                              e.dataTransfer.setData(CHANNEL_DRAG_TYPE, channel.id);
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggingChannel(channel.id);
                            }}
                            onDragEnd={() => {
                              setDraggingChannel(null);
                              setDropTarget(null);
                            }}
                          >
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
                                  {channel.emoji ? (
                                    <span aria-hidden="true" className="w-4 shrink-0 text-center">{channel.emoji}</span>
                                  ) : (
                                    <Hash className="h-4 w-4 shrink-0" />
                                  )}
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
                                {/* The emoji and the heading it files under (CMN-11).
                                    Both save on change rather than behind a Save button:
                                    they are single values, and a control that looks set
                                    but is not saved is how an admin ends up believing
                                    the sidebar says something it does not. */}
                                <span className="flex items-center gap-1">
                                  <EmojiPicker
                                    value={channel.emoji ?? ''}
                                    onChange={(emoji) => handleChannelDetail(channel.id, { emoji: emoji || null })}
                                  />
                                  <label className="sr-only" htmlFor={`section-${channel.id}`}>
                                    Section for {channel.name}
                                  </label>
                                  <select
                                    id={`section-${channel.id}`}
                                    value={channel.sectionId ?? ''}
                                    disabled={channelBusy}
                                    onChange={(e) =>
                                      handleChannelDetail(channel.id, { sectionId: e.target.value || null })
                                    }
                                    className="rounded-md border border-gray-200 px-1 py-0.5 text-[11px] text-gray-600"
                                  >
                                    <option value="">No section</option>
                                    {sectionList.map((section) => (
                                      <option key={section.id} value={section.id}>{section.name}</option>
                                    ))}
                                  </select>
                                </span>

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
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>

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

            {/* Sections (CMN-11) — the headings channels file under, the way
                Circle groups them. Only here, in manage mode: a heading with
                no channels under it is invisible in the member sidebar, so
                this is the one place an admin can see one they have made and
                not yet used. */}
            {isAdmin && managing && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Sections
                </h3>

                <ul className="space-y-1">
                  {sectionList.map((section, index) => (
                    <li key={section.id}>
                      {renamingSection === section.id ? (
                        <form
                          className="flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleRenameSection(section.id);
                          }}
                        >
                          <input
                            autoFocus
                            value={sectionDraft}
                            onChange={(e) => setSectionDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Escape' && setRenamingSection(null)}
                            className="input min-w-0 flex-1 text-sm"
                            aria-label={`Rename the ${section.name} section`}
                          />
                          <button type="submit" disabled={channelBusy} className="btn-primary px-2 text-xs">
                            Save
                          </button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1">
                          {/* Its own line: beside four buttons in a 240px rail,
                              "Groups and Clubs" was truncated to "G…". */}
                          <span className="w-full break-words text-sm text-gray-700">
                            {section.name}
                            <span className="ml-1 text-[11px] text-gray-400">
                              {section._count?.channels ?? 0}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleMoveSection(section.id, -1)}
                            disabled={channelBusy || index === 0}
                            className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveSection(section.id, 1)}
                            disabled={channelBusy || index === sectionList.length - 1}
                            className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSectionDraft(section.name);
                              setRenamingSection(section.id);
                            }}
                            className="text-[11px] text-gray-400 hover:text-gray-700"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteSection(section.id, section.name, section._count?.channels ?? 0)
                            }
                            disabled={channelBusy}
                            className="text-[11px] text-gray-400 hover:text-red-600 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                <form
                  className="mt-2 flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateSection();
                  }}
                >
                  <input
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    placeholder="New section"
                    maxLength={40}
                    className="input min-w-0 flex-1 text-sm"
                    aria-label="New section name"
                  />
                  <button
                    type="submit"
                    disabled={channelBusy || !newSectionName.trim()}
                    className="btn-primary px-2 text-xs disabled:opacity-50"
                  >
                    {channelBusy ? '...' : 'Add'}
                  </button>
                </form>
              </div>
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
              {/*
                One-to-one threads only. This pane is keyed by member and
                composes by picking a person, so a group conversation has no
                way to open here — those live on the member's Messages page,
                which is built for them (CMN-16).
              */}
              {(conversations ?? [])
                .filter((conv) => !conv.isGroup)
                .map((conv) => {
                  const other = conv.participants.find((pp) => pp.userId !== user?.id);
                  if (!other) return null;

                  return (
                    <li key={conv.id}>
                      <button
                        onClick={() => setView({ type: 'dm', userId: other.userId, name: other.name ?? undefined })}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                          view?.type === 'dm' && view.userId === other.userId
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <span className="truncate">{other.name ?? 'Unknown'}</span>
                        {conv.unreadCount > 0 && (
                          <span className="rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {conv.unreadCount}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              {(conversations ?? []).filter((c) => !c.isGroup).length === 0 && !showMemberPicker && (
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
            /*
              A chat column, the same way round as the member's Commons
              (CMN-15).

              Charley: "The Admin's version of the Commons should have the
              same vertical orientation of the member's version, with the
              message composer on the bottom and the latest message on the
              bottom with older messages running vertically to the top."

              It read the other way round — composer at the top, newest post
              under it, older ones below — so the same conversation ran in
              opposite directions depending on which door you came through.
              An organiser reading a thread in Admin and then in the portal
              had to re-learn which end was new.
            */
            <div className="flex min-h-[30rem] min-w-0 flex-1 flex-col lg:h-[calc(100vh-15rem)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-2">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedChannel ? `#${selectedChannel.name}` : 'All Posts'}
                </h2>
              </div>

              {postsLoading ? (
                <div className="flex flex-1 items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
                </div>
              ) : (
                <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {stream.map((post) => {
                    const authorName = post.author.name ?? 'Unknown';
                    const initial = authorName.charAt(0).toUpperCase();
                    const isExpanded = expandedPostId === post.id;

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
                            {(isAdmin || post.author?.id === user?.id) && (
                              <button
                                onClick={() =>
                                  setRemoving({
                                    kind: 'post',
                                    id: post.id,
                                    who: authorName,
                                    what: 'post',
                                  })
                                }
                                className="mt-1 text-xs font-medium text-gray-400 hover:text-red-600"
                              >
                                Delete post
                              </button>
                            )}
                            <div
                              className="prose prose-sm mt-1 max-w-none whitespace-pre-wrap text-sm text-gray-700"
                              dangerouslySetInnerHTML={{ __html: renderBodyHtml(post.body) }}
                            />

                            {/*
                              The same bar the rest of the product uses
                              (CMN-20). These were four hand-rolled chips that
                              could only ever add, showed their count only
                              after a round trip, and triggered a re-fetch of
                              the posts list and the open thread — so reacting
                              reloaded the conversation under the reader.
                            */}
                            <ReactionBar
                              reactions={reactionOverrides[post.id] ?? post.reactions ?? []}
                              onToggle={(emoji) => handleReact(post.id, emoji)}
                            />

                            <div className="mt-2 flex items-center gap-3">
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
                                    canDelete={isAdmin}
                                    onDelete={(c) =>
                                      setRemoving({
                                        kind: 'comment',
                                        id: c.id,
                                        who: c.author?.name ?? 'this member',
                                        what: 'comment',
                                      })
                                    }
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

                  {stream.length === 0 && (
                    <div className="py-12 text-center text-sm text-gray-500">No posts in this channel yet.</div>
                  )}

                  {/* The end of the conversation, which is where this opens. */}
                  <div ref={bottom} />
                </div>
              )}

              {/* Below the messages, like every chat anybody uses. */}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <RichComposer
                  value={newPostBody}
                  onChange={setNewPostBody}
                  onSubmit={handleCreatePost}
                  placeholder={selectedChannel ? `Post in #${selectedChannel.name}...` : 'Write something...'}
                  submitLabel="Post"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        Confirmed, never inline (CMN-18).

        This removes somebody else's words, takes their replies and attached
        files with them, and cannot be undone. The sentence names whose it is
        and what else goes, because "are you sure?" does not tell an admin what
        they are about to lose.
      */}
      <Modal
        open={Boolean(removing)}
        onClose={() => {
          if (!deleting) {
            setRemoving(null);
            setDeleteError('');
          }
        }}
        title={removing?.kind === 'post' ? 'Delete this post?' : 'Delete this comment?'}
      >
        {removing && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This deletes {removing.who === 'this member' ? 'a' : `${removing.who}\u2019s`}{' '}
              {removing.what}
              {removing.kind === 'post'
                ? ', along with every comment and reply under it'
                : ', along with any replies to it'}
              , and any files attached. It cannot be undone, and the member is not told.
            </p>
            <p className="text-sm text-gray-500">
              It will show in this co-op&rsquo;s audit log as deleted by you.
            </p>

            {deleteError && (
              <p className="text-sm text-red-600" role="alert">
                {deleteError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="btn-danger text-sm"
              >
                {deleting ? 'Deleting\u2026' : `Yes, delete this ${removing.what}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRemoving(null);
                  setDeleteError('');
                }}
                disabled={deleting}
                className="btn-secondary text-sm"
              >
                Keep it
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ReplyBox({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [draft, setDraft] = useState('');

  /*
    No flex wrapper (CMN-20).

    This was a `<div className="flex gap-2">` around a single child. The
    composer's own root carries no width, and a flex item is `flex: 0 1 auto`,
    so it collapsed to the intrinsic width of its toolbar — a comment box about
    two hundred pixels wide at the foot of a full-width thread. The composer at
    the bottom of the channel was never wrapped, which is why only this one
    looked wrong.
  */
  return (
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
  );
}
