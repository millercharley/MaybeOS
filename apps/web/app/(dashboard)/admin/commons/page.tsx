'use client';

import { useState } from 'react';
import { Plus, MessageSquare, Hash, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

export default function CommonsPage() {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  const { data: channels, loading: channelsLoading, error: channelsError } = useApi(
    (token, orgId) => api.commons.listChannels(orgId, token),
    [],
  );

  const { data: postsData, loading: postsLoading } = useApi(
    (token, orgId) => {
      const channelId = activeChannelId ?? channels?.[0]?.id;
      if (!channelId) return Promise.resolve({ data: [], meta: { page: 1, perPage: 25, total: 0, totalPages: 0 } });
      return api.commons.listPosts(orgId, channelId, token);
    },
    [activeChannelId, channels],
  );

  const { data: proposals, loading: proposalsLoading } = useApi(
    (token, orgId) => api.commons.listProposals(orgId, token),
    [],
  );

  const selectedChannelId = activeChannelId;
  const selectedChannel = channels?.find((c) => c.id === selectedChannelId);

  const posts = postsData?.data ?? [];
  const proposalList = proposals ?? [];

  if (channelsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (channelsError) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load channels: {channelsError}
      </div>
    );
  }

  const channelList = channels ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Commons</h1>

      {/* Two-column: channels + feed */}
      <div className="flex gap-6">
        {/* Channels sidebar */}
        <div className="w-56 shrink-0">
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Channels
            </h2>
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setActiveChannelId(null)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    activeChannelId === null
                      ? 'bg-brand-50 text-brand-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    All
                  </span>
                </button>
              </li>
              {channelList.map((channel) => (
                <li key={channel.id}>
                  <button
                    onClick={() => setActiveChannelId(channel.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                      activeChannelId === channel.id
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Hash className="h-4 w-4" />
                      {channel.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedChannel ? `#${selectedChannel.name}` : 'All Posts'}
            </h2>
            <button className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Post
            </button>
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
                const timeAgo = new Date(post.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });

                return (
                  <div key={post.id} className="card cursor-pointer transition-shadow hover:shadow-md">
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
                        <span className="text-sm font-medium text-brand-700">
                          {initial}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{authorName}</span>
                          <span className="text-xs text-gray-400">&middot;</span>
                          <span className="text-xs text-gray-400">{timeAgo}</span>
                        </div>
                        {post.title && (
                          <h3 className="mt-1 text-sm font-medium text-gray-900">{post.title}</h3>
                        )}
                        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{post.body}</p>
                        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>{post._count?.comments ?? 0} comments</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {posts.length === 0 && (
                <div className="py-12 text-center text-sm text-gray-500">
                  No posts in this channel yet.
                </div>
              )}
            </div>
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
              const votes = proposal.votes ?? { yes: 0, no: 0, abstain: 0, total: 0 };
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

                  {/* Vote bars */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ThumbsUp className="h-3.5 w-3.5 text-green-500" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-green-500"
                            style={{ width: `${yesPercent}%` }}
                          />
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
                          <div
                            className="h-2 rounded-full bg-red-500"
                            style={{ width: `${noPercent}%` }}
                          />
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
                          <div
                            className="h-2 rounded-full bg-gray-400"
                            style={{ width: `${abstainPercent}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500">
                        {votes.abstain} ({abstainPercent}%)
                      </span>
                    </div>
                  </div>

                  {/* Quorum progress */}
                  {quorum > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>Quorum progress</span>
                        <span>{Math.min(quorumPercent, 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                        <div
                          className="h-1.5 rounded-full bg-brand-500"
                          style={{ width: `${Math.min(quorumPercent, 100)}%` }}
                        />
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
              <div className="col-span-full py-12 text-center text-sm text-gray-500">
                No proposals found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
