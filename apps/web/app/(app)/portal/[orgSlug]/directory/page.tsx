'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Search, MessageCircle, EyeOff } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, LedgerHolder, MemberLedger } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { useMemberCard } from '@/contexts/member-card-context';

/**
 * Members (MEM-17, MEM-19, MEM-24) — the co-op's directory.
 *
 * It used to be the cap table too: every member listed largest holding first,
 * numbered, with their shares and their percentage of the co-op beside their
 * name. Charley, 2026-10-02: "it feels like a ranking". It was one — a
 * directory that told each member where they came in a league table of their
 * own community every time they looked somebody up.
 *
 * So the holdings went to each member's own profile, where they are nobody
 * else's business, and this is a directory: everybody, alphabetically, and a
 * way to say hello. The API no longer sends the figures at all, which is the
 * difference between not showing something and not disclosing it.
 *
 * What it still will not show is how to reach anyone outside MaybeOS. No
 * email and no phone number for any role.
 */
export default function MemberLedgerPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [ledger, setLedger] = useState<MemberLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [search, setSearch] = useState('');
  // The same card every name in MaybeOS opens (MEM-18) — and since MEM-24 the
  // only place a member sees what they themselves own.
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

  /**
   * `?member=<id>` opens that member's card (CMN-11).
   *
   * A member mention in the Commons is a real link to this page, so following
   * it — in a new tab, from an email quote, or with JavaScript yet to upgrade
   * the click — has to land on the person rather than on a list of everybody.
   * Read from the location rather than `useSearchParams`, which would need a
   * Suspense boundary around the page, and only once the ledger is in so the
   * card opens over something.
   */
  useEffect(() => {
    if (!ledger) return;
    const wanted = new URLSearchParams(window.location.search).get('member');
    if (!wanted) return;
    const holder = ledger.holders.find((h) => h.userId === wanted);
    openMember({ userId: wanted, name: holder?.user?.name ?? null });
  }, [ledger, openMember]);

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

  const members = holders.length + (ledger?.privateMembers.count ?? 0);

  // Name only. Searching an address would answer "is this person a member
  // here?" for anyone holding a list of them.
  const filtered = search
    ? holders.filter((h) => h.user.name?.toLowerCase().includes(search.toLowerCase()))
    : holders;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`${members} ${members === 1 ? 'member' : 'members'}`}
      />

      {failure && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}

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
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="w-14 px-2 py-3">
                <span className="sr-only">Message</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {filtered.map((holder) => (
              <tr key={holder.userId} className={holder.isYou ? 'bg-brand-50/40' : undefined}>
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

            {/* Counted, never named — the promise `isPublic` makes. */}
            {!search && ledger && ledger.privateMembers.count > 0 && (
              <AggregateRow
                label={`${ledger.privateMembers.count} ${
                  ledger.privateMembers.count === 1 ? 'member keeps their' : 'members keep their'
                } profile private`}
              />
            )}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-500">
                  {search ? 'No members match your search.' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>

        </table>
      </div>

    </div>
  );
}

function AggregateRow({ label }: { label: string }) {
  return (
    <tr className="text-gray-500">
      <td className="px-4 py-3 italic">{label}</td>
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
