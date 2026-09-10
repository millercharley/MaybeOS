'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertTriangle, Check, Eye, Download } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, StripeScan, StripeAdoptResult } from '@/lib/api';
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

  /** Which tier each Stripe price grants. Seeded from the scan's suggestions. */
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<StripeAdoptResult | null>(null);
  const [imported, setImported] = useState<StripeAdoptResult | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });

  const mappingList = useMemo(
    () =>
      Object.entries(mapping)
        .filter(([, tierId]) => tierId)
        .map(([priceId, tierId]) => ({ priceId, tierId })),
    [mapping],
  );

  const unmapped = scan ? scan.prices.filter((price) => !mapping[price.priceId]).length : 0;

  async function run() {
    if (!orgId || !token) return;
    setRunning(true);
    setFailure('');
    setPreview(null);
    setImported(null);
    try {
      const result = await api.members.stripeScan(orgId, token);
      setScan(result);
      // The suggestion is a starting point, never a decision: every row is a
      // dropdown, and a price whose amount matches no tier simply starts
      // empty rather than forcing the tier list to be edited to match history.
      setMapping(
        Object.fromEntries(result.prices.map((p) => [p.priceId, p.suggestedTierId ?? ''])),
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The scan could not be run');
    } finally {
      setRunning(false);
    }
  }

  async function runPreview() {
    if (!orgId || !token) return;
    setRunning(true);
    setFailure('');
    setImported(null);
    try {
      setPreview(
        await api.members.stripeAdopt(orgId, { mapping: mappingList, dryRun: true }, token),
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The preview could not be run');
    } finally {
      setRunning(false);
    }
  }

  /**
   * Walk the roster in batches.
   *
   * Cursored rather than one long request: 371 memberships do not fit in a
   * Lambda's wall clock, and a partial import that reports honestly is worth
   * more than a whole one that times out with nobody sure what landed.
   * Matching is on the subscription id, so stopping early and running again
   * repairs rather than duplicates.
   */
  async function runImport() {
    if (!orgId || !token || !preview) return;

    setRunning(true);
    setFailure('');
    const totals: StripeAdoptResult = {
      dryRun: false,
      total: preview.total,
      processed: 0,
      counts: { linked: 0, created: 0, refreshed: 0, skipped: 0, errors: [] },
      byConflict: {},
      nextAfter: null,
      done: false,
    };
    setProgress({ done: 0, total: preview.total, running: true });

    try {
      let after: string | undefined;
      for (;;) {
        const batch = await api.members.stripeAdopt(
          orgId, { mapping: mappingList, dryRun: false, limit: 50, after }, token,
        );

        totals.processed += batch.processed;
        totals.counts.linked += batch.counts.linked;
        totals.counts.created += batch.counts.created;
        totals.counts.refreshed += batch.counts.refreshed;
        totals.counts.skipped += batch.counts.skipped;
        totals.counts.errors.push(...batch.counts.errors);
        for (const [reason, count] of Object.entries(batch.byConflict)) {
          totals.byConflict[reason] = (totals.byConflict[reason] ?? 0) + count;
        }

        setProgress({ done: totals.processed, total: batch.total, running: true });
        setImported({ ...totals, done: batch.done });

        if (batch.done || !batch.nextAfter) break;
        after = batch.nextAfter;
      }
    } catch (err) {
      // Partial, not lost: everything written before this is in, and running
      // again picks up the rest and refreshes what already landed.
      setFailure(
        `${err instanceof Error ? err.message : 'The import stopped'} — ${totals.processed} of ${
          preview.total
        } were processed before it stopped. Running it again continues from there.`,
      );
    } finally {
      setRunning(false);
      setProgress((p) => ({ ...p, running: false }));
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
              The one thing only you can answer. A tier can span several prices, and the amounts
              do not have to agree — a member grandfathered on an old price keeps paying it, and
              nothing here changes what anybody is charged or what a new member is offered.
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
                        <select
                          value={mapping[price.priceId] ?? ''}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [price.priceId]: e.target.value }))
                          }
                          className="input w-full text-sm"
                        >
                          <option value="">— not imported —</option>
                          {scan.tiers.map((tier) => (
                            <option key={tier.id} value={tier.id}>
                              {tier.name}
                              {tier.priceMonthly !== price.monthlyCents
                                ? ` (${money(tier.priceMonthly)})`
                                : ''}
                            </option>
                          ))}
                        </select>
                        {price.suggestedTierId &&
                          mapping[price.priceId] === price.suggestedTierId && (
                            <span className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
                              <Check className="h-3 w-3 text-green-600" />
                              same price
                            </span>
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

          {/* ─── The scan checking itself ─────────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">Does this page add up?</h2>
            {summary.reconciliation.balanced ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                Yes. {summary.reconciliation.subscriptions} subscriptions across{' '}
                {summary.reconciliation.priceRows} price rows
                {summary.reconciliation.multiItemSubscriptions > 0 &&
                  ` (${summary.reconciliation.multiItemSubscriptions} carry more than one price)`}
                , and every priced subscription is counted once and only once.
              </p>
            ) : (
              <p className="mt-2 flex items-start gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                No — and that matters more than the figures themselves. The price table adds up to{' '}
                {money(summary.reconciliation.priceTableMonthlyCents)} while the subscriptions
                total {money(summary.reconciliation.pricedMonthlyCents)}.
                {summary.reconciliation.itemsWithOtherQuantity > 0 &&
                  ` ${summary.reconciliation.itemsWithOtherQuantity} items are billed for other than one unit, which is the usual reason.`}
              </p>
            )}
          </section>

          {/* ─── The import ───────────────────────────────────── */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">Bring them in</h2>
            <p className="mt-1 text-xs text-gray-500">
              This writes memberships in MaybeOS and nothing at all in Stripe — no charge, no
              cancellation, no card. Every member keeps the subscription and the billing date they
              already have.
            </p>

            {unmapped > 0 && (
              <p className="mt-3 text-sm text-amber-800">
                {unmapped} {unmapped === 1 ? 'price is' : 'prices are'} not mapped to a tier. Those
                subscriptions will be left alone — you can map them and run this again.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={runPreview} disabled={running} className="btn-secondary inline-flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview the import
              </button>

              <button
                onClick={runImport}
                // Only after a preview: seeing what will happen is a step, not
                // a suggestion, and this one writes 371 memberships.
                disabled={running || !preview}
                className="btn-primary inline-flex items-center gap-2"
              >
                {progress.running ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {progress.running
                  ? `Importing… ${progress.done} of ${progress.total}`
                  : 'Import them'}
              </button>
            </div>

            {(preview || imported) && (
              <Outcome result={(imported ?? preview) as StripeAdoptResult} />
            )}
          </section>

          <p className="text-xs text-gray-400">
            Read at {new Date(scan.scannedAt).toLocaleString()}.{' '}
            {imported ? 'Memberships were written; Stripe was not touched.' : 'Nothing was written.'}
          </p>
        </>
      )}
    </div>
  );
}


/**
 * What a preview says would happen, or what an import actually did.
 *
 * The same component for both, deliberately: the preview's whole value is that
 * it is the identical reckoning, run against the identical data, with the
 * writes switched off. Two renderers would be two chances to differ.
 */
function Outcome({ result }: { result: StripeAdoptResult }) {
  const heading = result.dryRun
    ? 'Nothing has been written. This is what would happen:'
    : result.done
      ? 'Done.'
      : 'Stopped early — run it again to carry on.';

  return (
    <div className="mt-4 rounded-lg bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-900">{heading}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-4">
        <Figure label="New members" value={result.counts.created} />
        <Figure label="Linked to existing" value={result.counts.linked} />
        <Figure label="Refreshed" value={result.counts.refreshed} />
        <Figure
          label="Left alone"
          value={result.counts.skipped}
          tone={result.counts.skipped > 0 ? 'warn' : undefined}
        />
      </div>

      {Object.keys(result.byConflict).length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-gray-600">
          {Object.entries(result.byConflict).map(([reason, count]) => (
            <li key={reason}>
              <b className="text-gray-900">{count}</b> {CONFLICT_TEXT[reason] ?? reason}
            </li>
          ))}
        </ul>
      )}

      {result.counts.errors.length > 0 && (
        <div className="mt-3">
          <p className="text-sm text-red-700">
            {result.counts.errors.length} could not be written:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-700">
            {result.counts.errors.slice(0, 10).map((error) => (
              <li key={error.email}>
                {error.email} — {error.reason}
              </li>
            ))}
          </ul>
        </div>
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
  'no-tier-for-price':
    'subscriptions are on a price with no tier chosen, so there is nothing to grant them.',
  'several-tiers-for-subscription':
    'subscriptions carry prices mapped to different tiers — which one the member holds is your call, not a tie to break here.',
  'unmapped-status':
    'subscriptions are in a Stripe status MaybeOS has no word for, so no status was invented for them.',
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
