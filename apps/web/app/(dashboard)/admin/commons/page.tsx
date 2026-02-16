'use client';

import { useState } from 'react';
import { Plus, MessageSquare, Hash, ThumbsUp, ThumbsDown, Minus } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  postCount: number;
}

interface Post {
  id: string;
  channel: string;
  author: string;
  authorInitial: string;
  title: string;
  body: string;
  commentCount: number;
  timeAgo: string;
}

interface Proposal {
  id: string;
  title: string;
  yesVotes: number;
  noVotes: number;
  abstainVotes: number;
  quorumRequired: number;
  totalVoters: number;
  status: 'OPEN' | 'PASSED' | 'FAILED';
}

const channels: Channel[] = [
  { id: '1', name: 'General', postCount: 48 },
  { id: '2', name: 'Announcements', postCount: 12 },
  { id: '3', name: 'Proposals', postCount: 7 },
];

const posts: Post[] = [
  {
    id: '1',
    channel: 'General',
    author: 'Sarah Chen',
    authorInitial: 'S',
    title: 'Welcome to our new community space!',
    body: 'Excited to announce that we have officially opened the doors to our renovated community center. Come check it out this weekend during our open house event...',
    commentCount: 14,
    timeAgo: '2 hours ago',
  },
  {
    id: '2',
    channel: 'Announcements',
    author: 'Marcus Johnson',
    authorInitial: 'M',
    title: 'Updated Community Guidelines',
    body: 'We have revised our community guidelines based on feedback from the recent survey. Key changes include updated quiet hours, new guest policies, and revised booking procedures...',
    commentCount: 8,
    timeAgo: '5 hours ago',
  },
  {
    id: '3',
    channel: 'General',
    author: 'Priya Patel',
    authorInitial: 'P',
    title: 'Looking for volunteers for the garden project',
    body: 'We are starting a community garden on the rooftop terrace. If you are interested in helping out with planning, planting, or maintenance, please comment below...',
    commentCount: 22,
    timeAgo: '1 day ago',
  },
  {
    id: '4',
    channel: 'Proposals',
    author: 'David Kim',
    authorInitial: 'D',
    title: 'Proposal: Extended weekend hours',
    body: 'I would like to propose that we extend our weekend operating hours from 8 AM to 10 PM instead of the current 9 AM to 8 PM schedule. This would allow more flexibility for...',
    commentCount: 31,
    timeAgo: '2 days ago',
  },
];

const proposals: Proposal[] = [
  {
    id: '1',
    title: 'Extended Weekend Hours',
    yesVotes: 67,
    noVotes: 18,
    abstainVotes: 9,
    quorumRequired: 80,
    totalVoters: 128,
    status: 'OPEN',
  },
  {
    id: '2',
    title: 'Budget Reallocation for Events',
    yesVotes: 82,
    noVotes: 12,
    abstainVotes: 6,
    quorumRequired: 80,
    totalVoters: 128,
    status: 'PASSED',
  },
  {
    id: '3',
    title: 'New Membership Tier: Student',
    yesVotes: 34,
    noVotes: 41,
    abstainVotes: 15,
    quorumRequired: 80,
    totalVoters: 128,
    status: 'FAILED',
  },
];

export default function CommonsPage() {
  const [activeChannel, setActiveChannel] = useState<string | null>(null);

  const filteredPosts = activeChannel
    ? posts.filter((p) => p.channel === activeChannel)
    : posts;

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
                  onClick={() => setActiveChannel(null)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    activeChannel === null
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
              {channels.map((channel) => (
                <li key={channel.id}>
                  <button
                    onClick={() => setActiveChannel(channel.name)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                      activeChannel === channel.name
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Hash className="h-4 w-4" />
                      {channel.name}
                    </span>
                    <span className="text-xs text-gray-400">{channel.postCount}</span>
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
              {activeChannel ? `#${activeChannel}` : 'All Posts'}
            </h2>
            <button className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Post
            </button>
          </div>

          <div className="space-y-4">
            {filteredPosts.map((post) => (
              <div key={post.id} className="card cursor-pointer transition-shadow hover:shadow-md">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
                    <span className="text-sm font-medium text-brand-700">
                      {post.authorInitial}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{post.author}</span>
                      <span className="text-xs text-gray-400">in #{post.channel}</span>
                      <span className="text-xs text-gray-400">&middot;</span>
                      <span className="text-xs text-gray-400">{post.timeAgo}</span>
                    </div>
                    <h3 className="mt-1 text-sm font-medium text-gray-900">{post.title}</h3>
                    <p className="mt-1 text-sm text-gray-500 line-clamp-2">{post.body}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>{post.commentCount} comments</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {filteredPosts.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-500">
                No posts in this channel yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active Proposals */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Active Proposals</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {proposals.map((proposal) => {
            const totalVotes = proposal.yesVotes + proposal.noVotes + proposal.abstainVotes;
            const quorumPercent = Math.round((totalVotes / proposal.quorumRequired) * 100);
            const yesPercent = totalVotes > 0 ? Math.round((proposal.yesVotes / totalVotes) * 100) : 0;
            const noPercent = totalVotes > 0 ? Math.round((proposal.noVotes / totalVotes) * 100) : 0;
            const abstainPercent = totalVotes > 0 ? Math.round((proposal.abstainVotes / totalVotes) * 100) : 0;

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
                      {proposal.yesVotes} ({yesPercent}%)
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
                      {proposal.noVotes} ({noPercent}%)
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
                      {proposal.abstainVotes} ({abstainPercent}%)
                    </span>
                  </div>
                </div>

                {/* Quorum progress */}
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
                    {totalVotes} of {proposal.quorumRequired} required votes
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
