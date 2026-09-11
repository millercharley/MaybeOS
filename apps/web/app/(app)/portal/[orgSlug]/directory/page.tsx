'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Search, MessageCircle, EyeOff } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, LedgerHolder, MemberLedger } from '@/lib/api';
import { formatOwnership, formatShares } from '@/lib/ledger';
import { PageHeader } from '@/components/layout/page-header';
import { useMemberCard } from '@/contexts/member-card-context';

/**
 * Members (MEM-17, MEM-19) — the Directory, and, when the co-op tracks them,
 * its cap table.
 *
 * Every member, what they hold, and what share of the co-op that is, visible
 * to the whole co-op: in a cooperative, who owns what is everybody's business.
 * Clicking a name opens the member card every name in MaybeOS opens; every
 * row but your own offers a message.
 *
 * What it will not show is how to reach anyone outside MaybeOS. No email and
 * no phone number are in the response for any role — the ledger is read by
 * every member, and a member list with addresses attached is exactly the thing
 * the directory promised never to be.
 */
export default function MemberLedgerPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [ledger, setLedger] = useState<MemberLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [search, setSearch] = useState('');
  // The same card every name in MaybeOS opens (MEM-18). Shares and ownership
  // stay in this table; the card is about the person.
  const { openMember } = useMemberCard();

  useEffect(() => {
    if (!org || !token) {
      setLoading(false);
      return;
    }
    api.ledger
      .get(org.id, token)
      .then(setLedger)
      .catch((err) => setFailure(err instanceof Error ? err.message : 'The ledger could not be loaded.'))
      .finally(() => setLoading(false));
  }, [org, token]);

  if (!token) {
    return (
      <div className="py-12 text-center">
        <Users className="mx-auto h-10 w-10 text-gray-300" />
        <PageHeader title="Members" description="Sign in to see the co-op's members." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const holders = ledger?.holders ?? [];
  const total = ledger?.totalShares ?? 0;
  // Share tracking is the co-op's choice (MEM-19). Off, this is a directory:
  // no shares were read, so there are no columns to show them in.
  const on = ledger?.sharesEnabled ?? false;
  const members = holders.length + (ledger?.privateMembers.count ?? 0);

  // Name only. Searching an address would answer "is this person a member
  // here?" for anyone holding a list of them.
  const filtered = search
    ? holders.filter((h) => h.user.name?.toLowerCase().includes(search.toLowerCase()))
    : holders;

  const asOf = ledger?.asOf
    ? new Date(ledger.asOf).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={[
          `${members} ${members === 1 ? 'member' : 'members'}`,
          on && total > 0 && `${formatShares(total)} shares distributed`,
          on && asOf && `as of ${asOf}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {failure && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}

      {on && total === 0 && (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          The co-op&apos;s cap table hasn&apos;t been imported yet, so every member shows no shares.
        </p>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {on && <th className="w-12 px-4 py-3 font-medium">#</th>}
              <th className="px-4 py-3 font-medium">Member</th>
              {on && <th className="px-4 py-3 text-right font-medium">Shares</th>}
              {on && <th className="px-4 py-3 text-right font-medium">Ownership</th>}
              <th className="w-14 px-2 py-3">
                <span className="sr-only">Message</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {filtered.map((holder) => (
              <tr key={holder.userId} className={holder.isYou ? 'bg-brand-50/40' : undefined}>
                {on && <td className="px-4 py-3 tabular-nums text-gray-400">{holder.rank}</td>}
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openMember({ userId: holder.userId, name: holder.user.name })}
                    className="group flex items-center gap-3 text-left"
                  >
                    <Avatar holder={holder} size="sm" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-gray-900 group-hover:underline">
                          {holder.user.name || 'Member'}
                        </span>
                        {holder.isYou && (
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                            You
                          </span>
                        )}
                        {holder.isPrivate && !holder.isYou && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-gray-400"
                            title="Hidden from other members — organisers see them"
                          >
                            <EyeOff className="h-3 w-3" /> Hidden
                          </span>
                        )}
                      </span>
                      {holder.headline && (
                        <span className="block truncate text-xs text-gray-500">{holder.headline}</span>
                      )}
                    </span>
                  </button>
                </td>
                {on && (
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">{formatShares(holder.shares)}</td>
                )}
                {on && (
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {formatOwnership(holder.shares, total)}
                  </td>
                )}
                <td className="px-2 py-3 text-right">
                  {!holder.isYou && org && (
                    <Link
                      href={`/portal/${org.slug}/messages/${holder.userId}`}
                      aria-label={`Message ${holder.user.name || 'this member'}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-brand-600"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Link>
                  )}
                </td>
              </tr>
            ))}

            {/* Every share is somewhere, so the column adds up to the total. */}
            {!search && ledger && ledger.privateMembers.count > 0 && (
              <AggregateRow
                label={`${ledger.privateMembers.count} ${
                  ledger.privateMembers.count === 1 ? 'member keeps their' : 'members keep their'
                } profile private`}
                shares={ledger.privateMembers.shares}
                total={total}
                on={on}
              />
            )}
            {!search && on && ledger && ledger.unlinked.count > 0 && (
              <AggregateRow
                label={`${ledger.unlinked.count} ${
                  ledger.unlinked.count === 1 ? 'holder' : 'holders'
                } on the cap table not yet in MaybeOS`}
                shares={ledger.unlinked.shares}
                total={total}
                on={on}
              />
            )}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={on ? 5 : 2} className="px-4 py-8 text-center text-sm text-gray-500">
                  {search ? 'No members match your search.' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>

          {on && (
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium text-gray-900">
              <tr>
                <td className="px-4 py-3" />
                <td className="px-4 py-3">Total distributed</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatShares(total)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{total > 0 ? '100.00%' : '—'}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

    </div>
  );
}

function AggregateRow({
  label,
  shares,
  total,
  on,
}: {
  label: string;
  shares: number;
  total: number;
  on: boolean;
}) {
  return (
    <tr className="text-gray-500">
      {on && <td className="px-4 py-3" />}
      <td className="px-4 py-3 italic">{label}</td>
      {on && <td className="px-4 py-3 text-right tabular-nums">{formatShares(shares)}</td>}
      {on && <td className="px-4 py-3 text-right tabular-nums">{formatOwnership(shares, total)}</td>}
      <td />
    </tr>
  );
}

function Avatar({ holder, size }: { holder: LedgerHolder; size: 'sm' | 'lg' }) {
  const box = size === 'sm' ? 'h-9 w-9' : 'h-16 w-16';
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-brand-100`}>
      {holder.user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={holder.user.avatarUrl} alt="" className={`${box} rounded-full object-cover`} />
      ) : (
        <span className={`${size === 'sm' ? 'text-sm' : 'text-xl'} font-medium text-brand-700`}>
          {holder.user.name?.charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  );
}
