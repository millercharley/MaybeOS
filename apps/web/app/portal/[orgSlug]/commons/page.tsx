'use client';

import { useState, FormEvent } from 'react';
import { MessageSquare, ThumbsUp, ThumbsDown, Minus, Send } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Channel, Post, Proposal } from '@/lib/api';

type Tab = 'channels' | 'proposals';

export default function PortalCommonsPage() {
  const { org } = usePortal();
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
          onClick={() => setTab('proposals')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'proposals' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Proposals
        </button>
      </div>

      {tab === 'channels' && <ChannelsSection />}
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

  useState(() => {
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
      .catch(() => {})
      .finally(() => setLoading(false));
  });

  async function loadPosts(channelId: string) {
    if (!org || !token) return;
    setSelectedChannel(channelId);
    setPosts([]);
    try {
      const data = await api.commons.listPosts(org.id, channelId, token);
      setPosts(data.data || []);
    } catch {}
  }

  async function handlePost(e: FormEvent) {
    e.preventDefault();
    if (!org || !token || !selectedChannel || !newPost.trim()) return;
    setPosting(true);
    try {
      const post = await api.commons.createPost(org.id, selectedChannel, { body: newPost }, token);
      setPosts((prev) => [post, ...prev]);
      setNewPost('');
    } catch {}
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
    return <p className="py-8 text-center text-sm text-gray-500">No channels yet.</p>;
  }

  return (
    <div className="flex gap-6">
      <div className="w-48 shrink-0 space-y-1">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => loadPosts(ch.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              selectedChannel === ch.id ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            # {ch.name}
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
              <div key={post.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
                    {post.author?.name?.charAt(0) || '?'}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{post.author?.name || 'Member'}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-700">{post.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalsSection() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);

  useState(() => {
    if (!org || !token) { setLoading(false); return; }
    api.commons
      .listProposals(org.id, token)
      .then(setProposals)
      .catch(() => {})
      .finally(() => setLoading(false));
  });

  async function handleVote(proposalId: string, choice: string) {
    if (!org || !token) return;
    setVotingId(proposalId);
    try {
      await api.commons.vote(org.id, proposalId, choice, token);
      const updated = await api.commons.getProposal(org.id, proposalId, token);
      setProposals((prev) => prev.map((p) => (p.id === proposalId ? updated : p)));
    } catch {}
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
    return <p className="py-8 text-center text-sm text-gray-500">No proposals yet.</p>;
  }

  return (
    <div className="space-y-4">
      {proposals.map((proposal) => {
        const total = proposal.votes?.total || 0;
        const yesPercent = total > 0 ? Math.round(((proposal.votes?.yes || 0) / total) * 100) : 0;

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
                  <span>Yes: {proposal.votes?.yes}</span>
                  <span>No: {proposal.votes?.no}</span>
                  <span>Abstain: {proposal.votes?.abstain}</span>
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
