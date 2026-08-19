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
}: {
  comment: CommentT;
  depth: number;
  onReply: (parentId: string, body: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');

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
            </div>
            <p className="mt-0.5 text-sm text-gray-700">{comment.body}</p>
          </div>
          <button
            onClick={() => setReplying((r) => !r)}
            className="mt-1 text-xs font-medium text-gray-400 hover:text-brand-600"
          >
            Reply
          </button>

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
            <CommentThread key={reply.id} comment={reply} depth={depth + 1} onReply={onReply} />
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
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [newPostBody, setNewPostBody] = useState('');
  const [dmDraft, setDmDraft] = useState('');
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const { data: channels, loading: channelsLoading, error: channelsError, refetch: refetchChannels } = useApi(
    (token, orgId) => api.commons.listChannels(orgId, token),
    [],
  );

  const { data: collections } = useApi(
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

  const { data: pageContent, loading: pageLoading } = useApi<CollectionPage | null>(
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
      <h1 className="text-2xl font-bold text-gray-900">Commons</h1>

      <div className="flex gap-6">
        {/* Left rail: Collections, Channels, People */}
        <div className="w-60 shrink-0 space-y-4">
          {/* Collections */}
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Collections</h2>
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
                        {collection.pages.map((page) => (
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
                          </li>
                        ))}
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
            <div className="mb-3 flex items-center justify-between">
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
        <div className="flex-1 space-y-6">
          {view?.type === 'page' ? (
            pageLoading || !pageContent ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
              </div>
            ) : (
              <div className="card">
                <h2 className="text-xl font-semibold text-gray-900">{pageContent.title}</h2>
                <div
                  className="prose prose-sm mt-4 max-w-none text-gray-700"
                  dangerouslySetInnerHTML={{ __html: sanitizeWikiHtml(pageContent.body) }}
                />
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
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedChannel ? `#${selectedChannel.name}` : 'All Posts'}
                </h2>
              </div>

              <div className="card">
                <textarea
                  value={newPostBody}
                  onChange={(e) => setNewPostBody(e.target.value)}
                  placeholder={selectedChannel ? `Post in #${selectedChannel.name}...` : 'Write something...'}
                  rows={2}
                  className="input w-full resize-none"
                />
                <div className="mt-2 flex justify-end">
                  <button onClick={handleCreatePost} className="btn-primary inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Post
                  </button>
                </div>
              </div>

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
                            <p className="mt-1 text-sm text-gray-700">{post.body}</p>

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
                  <div className="mb-3 flex items-start justify-between">
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
                      <div className="flex items-center justify-between text-xs text-gray-500">
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
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onSubmit(draft.trim());
            setDraft('');
          }
        }}
        placeholder="Add a comment..."
        className="input flex-1 text-sm"
      />
      <button
        onClick={() => {
          if (draft.trim()) {
            onSubmit(draft.trim());
            setDraft('');
          }
        }}
        className="btn-secondary px-3"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
