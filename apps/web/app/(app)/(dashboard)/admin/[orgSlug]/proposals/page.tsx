'use client';

import { ThumbsUp, ThumbsDown, Minus, Vote } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

/**
 * What the co-op is deciding (CMN-15).
 *
 * Charley: "Create a different tab in the Administration nav panel for
 * Proposals." It was the bottom half of the admin's Commons page, under the
 * conversation — so a vote with a deadline sat below however many messages
 * the channel happened to hold, and the Commons becoming a chat column (where
 * the newest message is at the *bottom*) would have pushed it off the screen
 * entirely.
 *
 * They are two different jobs anyway. Reading the room and counting a vote
 * are not the same act, and only one of them has a deadline.
 */
export default function AdminProposalsPage() {
  const { data: proposals, loading } = useApi(
    (token, orgId) => api.commons.listProposals(orgId, token),
    [],
  );

  const list = proposals ?? [];
  const open = list.filter((p) => p.status === 'OPEN');
  const settled = list.filter((p) => p.status !== 'OPEN');

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="What the co-op is deciding, and how the vote is going."
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-12 text-center">
          <Vote className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
          <p className="mt-3 font-medium text-gray-900">Nothing to decide right now.</p>
          <p className="mt-1 text-sm text-gray-500">
            Proposals are raised in the Commons. When a member opens one, it turns up here with
            its count.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Open first, and under its own heading: a vote still running is
              the only thing on this page anybody has to act on. */}
          {open.length > 0 && (
            <Section title="Still open" proposals={open} />
          )}
          {settled.length > 0 && (
            <Section title="Decided" proposals={settled} />
          )}
        </div>
      )}
    </div>
  );
}

type Proposal = NonNullable<Awaited<ReturnType<typeof api.commons.listProposals>>>[number];

function Section({ title, proposals }: { title: string; proposals: Proposal[] }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} />
        ))}
      </div>
    </section>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const votes = proposal.voteTally ?? { yes: 0, no: 0, abstain: 0, total: 0 };
  const totalVotes = votes.yes + votes.no + votes.abstain;
  const quorum = proposal.quorum ?? 0;
  const quorumPercent = quorum > 0 ? Math.round((totalVotes / quorum) * 100) : 0;

  // Share of the votes cast, not of the co-op. A bar that reads 4% because
  // 420 members have not voted says nothing about what the 18 who did think.
  const share = (n: number) => (totalVotes > 0 ? Math.round((n / totalVotes) * 100) : 0);

  return (
    <div className="card">
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
        <Tally icon={<ThumbsUp className="h-3.5 w-3.5 text-green-500" />} bar="bg-green-500" count={votes.yes} percent={share(votes.yes)} />
        <Tally icon={<ThumbsDown className="h-3.5 w-3.5 text-red-500" />} bar="bg-red-500" count={votes.no} percent={share(votes.no)} />
        <Tally icon={<Minus className="h-3.5 w-3.5 text-gray-400" />} bar="bg-gray-400" count={votes.abstain} percent={share(votes.abstain)} />
      </div>

      {quorum > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
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
}

function Tally({
  icon,
  bar,
  count,
  percent,
}: {
  icon: React.ReactNode;
  bar: string;
  count: number;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="flex-1">
        <div className="h-2 rounded-full bg-gray-100">
          <div className={`h-2 rounded-full ${bar}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <span className="w-12 text-right text-xs text-gray-500">
        {count} ({percent}%)
      </span>
    </div>
  );
}
