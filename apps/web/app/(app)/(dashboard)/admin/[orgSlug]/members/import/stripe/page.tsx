'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertTriangle, Check, Eye } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, StripeScan } from '@/lib/api';
import { money } from '@/lib/fees';
import { PageHeader } from '@/components/layout/page-header';

/**
 * Look at the co-op's existing Stripe subscriptions (MIG-01).
 *
 * A co-op arriving from another platform already has live subscriptions on its
 * own Stripe account, and they are already in the right place: the money lands
 * in the co-op's bank and every billing date is already set. Adopting them is
 * a database write, not a payment migration — nobody re-enters a card.
 *
 * **This page only looks.** Nothing here writes to Stripe or to MaybeOS, and
 * the thing to look at is the last panel: if MaybeOS's recorded dues do not
 * add up to what Stripe is actually collecting, the difference is the list of
 * members an import would get wrong.
 */
export default function StripeScanPage(props: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [scan, setScan] = useState<StripeScan | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState('');

  async function run() {
    if (!orgId || !token) return;
    setRunning(true);
    setFailure('');
    try {
      setScan(await api.members.stripeScan(orgId, token));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The scan could not be run');
    } finally {
      setRunning(false);
    }
  }

  const summary = scan?.summary;
  const delta = summary?.money.deltaCents ?? 0;

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/${orgSlug}/members`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Members
      </Link>

      <div>
        <PageHeader title="Existing Stripe subscriptions" />
        <p className="mt-1 text-sm text-gray-500">
          What MaybeOS would do with the subscriptions already running on your Stripe account.
          This page <b>only looks</b> — nothing is charged, nothing is cancelled, no card is
          touched and no member is emailed.
        </p>
      </div>

      <button onClick={run} disabled={running || !orgId} className="btn-primary inline-flex items-center gap-2">
        {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
        {running ? 'Reading Stripe…' : scan ? 'Scan again' : 'Scan Stripe'}
      </button>

      {failure && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {failure}
        </p>
      )}

      {scan && summary && (
        <>
          {scan.truncated && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This scan stopped at its limit, so the figures below cover part of the account
              rather than all of it.
            </p>
          )}

          {/* ─── What Stripe holds ───────────────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">What Stripe holds</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <Figure label="Live subscriptions" value={summary.subscriptions.total} />
              {Object.entries(summary.subscriptions.byStatus).map(([status, count]) => (
                <Figure key={status} label={status.replace('_', ' ')} value={count} />
              ))}
              <Figure label="Ending at period end" value={summary.subscriptions.cancelingAtPeriodEnd} />
            </div>
            {summary.subscriptions.unpriced > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                {summary.subscriptions.unpriced} of these use a metered or tiered price, so they
                have no single monthly amount and are left out of the totals rather than guessed at.
              </p>
            )}
          </section>

          {/* ─── Prices to tiers ─────────────────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">Prices in use</h2>
            <p className="mt-1 text-xs text-gray-500">
              The one thing only you can answer. A tier can span several prices — members
              grandfathered on an old price keep paying it.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Price</th>
                    <th className="pb-2 pr-4 font-medium">Per month</th>
                    <th className="pb-2 pr-4 font-medium">Members</th>
                    <th className="pb-2 font-medium">Looks like</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {scan.prices.map((price) => (
                    <tr key={price.priceId}>
                      <td className="py-2 pr-4">
                        <span className="text-gray-900">{price.productName ?? 'Unnamed product'}</span>
                        <span className="ml-2 font-mono text-xs text-gray-400">{price.priceId}</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-900">
                        {price.monthlyCents === null ? '—' : money(price.monthlyCents)}
                        {price.interval && price.interval !== 'month' && (
                          <span className="ml-1 text-xs text-gray-400">
                            (billed {price.intervalCount > 1 ? `every ${price.intervalCount} ` : ''}
                            {price.interval}
                            {price.intervalCount > 1 ? 's' : 'ly'})
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-gray-900">{price.subscriptions}</td>
                      <td className="py-2">
                        {price.suggestedTierName ? (
                          <span className="inline-flex items-center gap-1.5 text-gray-900">
                            <Check className="h-3.5 w-3.5 text-green-600" />
                            {price.suggestedTierName}
                          </span>
                        ) : (
                          <span className="text-amber-700">needs a tier</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ─── People ──────────────────────────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">People</h2>
            <p className="mt-1 text-xs text-gray-500">Matched on email, and on nothing else.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <Figure label="Would link to a member" value={summary.people.link} />
              <Figure label="Would need creating" value={summary.people.create} />
              <Figure label="Already linked" value={summary.people.alreadyLinked} />
              <Figure label="Need you to decide" value={summary.people.conflicts} />
            </div>

            {summary.people.conflicts > 0 && (
              <ul className="mt-4 space-y-1 text-sm text-gray-600">
                {Object.entries(summary.people.byConflict).map(([reason, count]) => (
                  <li key={reason}>
                    <b className="text-gray-900">{count}</b> {CONFLICT_TEXT[reason] ?? reason}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-4 text-xs text-gray-500">
              {summary.people.membersWithoutSubscription} members already in MaybeOS matched no
              live subscription — free tier, comped, or lapsed. They are left alone.
            </p>
          </section>

          {/* ─── The number that decides it ──────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">One figure, two systems</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Figure label="Stripe collects, per month" value={money(summary.money.stripeMonthlyCents)} />
              <Figure label="MaybeOS believes it bills" value={money(summary.money.maybeosMonthlyCents)} />
              <Figure
                label="Difference"
                value={money(Math.abs(delta))}
                tone={delta === 0 ? 'good' : 'warn'}
              />
            </div>
            <p className="mt-3 text-sm text-gray-600">
              {delta === 0
                ? 'The two agree. Every live subscription is accounted for in MaybeOS.'
                : `${money(Math.abs(delta))} a month that Stripe is ${delta > 0 ? 'collecting and MaybeOS does not know about' : 'not collecting but MaybeOS thinks it is'}. That gap is the roster this import would fix.`}
            </p>
            {summary.money.pastDueMonthlyCents > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                A further {money(summary.money.pastDueMonthlyCents)} a month is past due — money
                at risk rather than money collected, so it is not counted above.
              </p>
            )}
          </section>

          <p className="text-xs text-gray-400">
            Read at {new Date(scan.scannedAt).toLocaleString()}. Nothing was written.
          </p>
        </>
      )}
    </div>
  );
}

const CONFLICT_TEXT: Record<string, string> = {
  'no-email': 'Stripe customers have no email address, so there is nothing to match them on.',
  'duplicate-email':
    'live subscriptions share an email address — either someone subscribed twice, or two people share an inbox.',
  'member-has-other-subscription':
    'members are already linked to a different subscription, which adopting over the top would orphan.',
};

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'warn';
}) {
  return (
    <div>
      <p
        className={`text-2xl font-semibold ${
          tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-green-700' : 'text-gray-900'
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
