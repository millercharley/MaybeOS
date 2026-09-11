'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Search, X, Calendar, Link2, MapPin, MessageCircle, EyeOff } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, LedgerHolder, MemberLedger } from '@/lib/api';
import { safeProfileLinks, profileLinkLabel } from '@/lib/profile-links';
import { GRANT_KINDS, GRANT_LABELS, formatOwnership, formatShares } from '@/lib/ledger';
import { PageHeader } from '@/components/layout/page-header';

/**
 * The Member Ledger (MEM-17) — the Directory, redesigned to read like a cap
 * table.
 *
 * Every member, what they hold, and what share of the co-op that is, visible
 * to the whole co-op: in a cooperative, who owns what is everybody's business.
 * Clicking a name opens their card; every row but your own offers a message.
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
  const [open, setOpen] = useState<LedgerHolder | null>(null);

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
        <PageHeader title="Member Ledger" description="Sign in to view the member ledger." />
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
        title="Member Ledger"
        description={[
          `${members} ${members === 1 ? 'member' : 'members'}`,
          total > 0 && `${formatShares(total)} shares distributed`,
          asOf && `as of ${asOf}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      {failure && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}

      {ledger && total === 0 && (
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
              <th className="w-12 px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 text-right font-medium">Shares</th>
              <th className="px-4 py-3 text-right font-medium">Ownership</th>
              <th className="w-14 px-2 py-3">
                <span className="sr-only">Message</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {filtered.map((holder) => (
              <tr key={holder.userId} className={holder.isYou ? 'bg-brand-50/40' : undefined}>
                <td className="px-4 py-3 tabular-nums text-gray-400">{holder.rank}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(holder)}
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
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{formatShares(holder.shares)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatOwnership(holder.shares, total)}
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

            {/* Every share is somewhere, so the column adds up to the total. */}
            {!search && ledger && ledger.privateMembers.count > 0 && (
              <AggregateRow
                label={`${ledger.privateMembers.count} ${
                  ledger.privateMembers.count === 1 ? 'member keeps their' : 'members keep their'
                } profile private`}
                shares={ledger.privateMembers.shares}
                total={total}
              />
            )}
            {!search && ledger && ledger.unlinked.count > 0 && (
              <AggregateRow
                label={`${ledger.unlinked.count} ${
                  ledger.unlinked.count === 1 ? 'holder' : 'holders'
                } on the cap table not yet in MaybeOS`}
                shares={ledger.unlinked.shares}
                total={total}
              />
            )}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {search ? 'No members match your search.' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>

          <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium text-gray-900">
            <tr>
              <td className="px-4 py-3" />
              <td className="px-4 py-3">Total distributed</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatShares(total)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{total > 0 ? '100.00%' : '—'}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {open && org && (
        <MemberCard holder={open} total={total} orgSlug={org.slug} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function AggregateRow({ label, shares, total }: { label: string; shares: number; total: number }) {
  return (
    <tr className="text-gray-500">
      <td className="px-4 py-3" />
      <td className="px-4 py-3 italic">{label}</td>
      <td className="px-4 py-3 text-right tabular-nums">{formatShares(shares)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{formatOwnership(shares, total)}</td>
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

/**
 * One member's card: who they are, what they hold, and a way to say hello.
 *
 * The equity comes first after the name because that is what this page is
 * for; the introduction follows because that is what somebody opening a card
 * before a first conversation actually wants.
 */
function MemberCard({
  holder,
  total,
  orgSlug,
  onClose,
}: {
  holder: LedgerHolder;
  total: number;
  orgSlug: string;
  onClose: () => void;
}) {
  const joined = new Date(holder.memberSince);
  const firstName = holder.user.name?.split(' ')[0] || 'this member';
  const kinds = GRANT_KINDS.filter((kind) => holder.breakdown[kind]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-20"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={holder.user.name || 'Member'}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar holder={holder} size="lg" />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-gray-900">{holder.user.name || 'Member'}</h2>
              {holder.headline && <p className="mt-0.5 text-sm text-gray-600">{holder.headline}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Member since {joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                {holder.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {holder.location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 rounded-xl bg-gray-50 p-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatShares(holder.shares)}</p>
            <p className="text-xs text-gray-500">shares</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatOwnership(holder.shares, total)}</p>
            <p className="text-xs text-gray-500">of the co-op</p>
          </div>
          {kinds.length > 0 && (
            <dl className="col-span-2 space-y-1 border-t border-gray-200 pt-3 text-sm">
              {kinds.map((kind) => (
                <div key={kind} className="flex flex-wrap justify-between gap-x-4">
                  <dt className="text-gray-500">{GRANT_LABELS[kind]}</dt>
                  <dd className="tabular-nums text-gray-900">{formatShares(holder.breakdown[kind] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {!holder.isYou && (
          <Link
            href={`/portal/${orgSlug}/messages/${holder.userId}`}
            className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2"
          >
            <MessageCircle className="h-4 w-4" />
            Message {firstName}
          </Link>
        )}

        {holder.bio ? (
          <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-gray-700">{holder.bio}</p>
        ) : (
          <p className="mt-5 text-sm italic text-gray-400">
            {holder.isYou ? "You haven't" : `${firstName} hasn't`} written an introduction yet.
          </p>
        )}

        {holder.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {holder.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        )}

        {safeProfileLinks(holder.links).length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {safeProfileLinks(holder.links).map((link) => (
              <li key={link}>
                <a
                  href={link}
                  target="_blank"
                  // noreferrer as well as noopener: these point off the co-op's
                  // site, and the page they land on has no business knowing
                  // which co-op sent them.
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline"
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{profileLinkLabel(link)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
