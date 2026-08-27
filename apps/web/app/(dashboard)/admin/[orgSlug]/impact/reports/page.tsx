'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, ExternalLink, FileText, Loader2, Lock, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, ApiError, ImpactReport, ReportPurchaseStatus, ReportSummary } from '@/lib/api';
import { WRITTEN_REPORT_PRICE_CENTS, money } from '@/lib/fees';
import { ReportBody } from '@/components/impact/report-body';

/**
 * Writing, editing and publishing the year-end report (IMP-22).
 *
 * The one artefact a co-op sends to somebody with money, so the page is built
 * around two facts an organiser has to be able to see: **what MaybeOS wrote
 * versus what they changed**, and **that publishing is a decision** — after
 * which the report stops being editable, because people have been sent it.
 */
export default function ReportsPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const orgSlug = useParams<{ orgSlug: string }>().orgSlug;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [open, setOpen] = useState<ImpactReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Null until a report is open; only ever set for the written one. */
  const [purchase, setPurchase] = useState<ReportPurchaseStatus | null>(null);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setReports(await api.impact.listReports(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Watch for the prose while it is being written (IMP-23).
   *
   * Composition takes minutes and a synchronous function has seconds, so the
   * request that asks for it returns immediately and this waits instead. The
   * report is readable throughout — it is the free report until the rewrite
   * lands over it — so this is a page getting better, not a page loading.
   */
  useEffect(() => {
    if (!open || !token || !orgId) return;
    if (open.composeStatus !== 'PENDING' && open.composeStatus !== 'COMPOSING') return;

    const timer = setInterval(async () => {
      try {
        const fresh = await api.impact.getReport(orgId, open.id, token);
        setOpen(fresh);
      } catch {
        // A failed poll is not worth a red banner. The next one will do.
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [open, token, orgId]);

  /**
   * Come back from Stripe onto the report that was paid for.
   *
   * Read from `window.location` rather than `useSearchParams` so this page
   * needs no Suspense boundary for one query string. The `paid=1` flag is not
   * trusted for anything — the entitlement comes from the webhook, and this
   * only decides which report to open.
   */
  useEffect(() => {
    if (!token || !orgId) return;
    const reportId = new URLSearchParams(window.location.search).get('report');
    if (!reportId) return;
    window.history.replaceState({}, '', window.location.pathname);
    openReport(reportId);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orgId]);

  const run = async (fn: () => Promise<unknown>) => {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  async function generate(tier: 'BASIC' | 'WRITTEN') {
    await run(async () => {
      const report = await api.impact.generateReport(orgId!, { tier }, token!);
      setOpen(report);
      // The written one is free to make and free to read. What it costs is
      // putting it in front of somebody (IMP-23), so the price is not
      // mentioned until there is something to look at.
      setPurchase(await api.impact.reportPurchaseStatus(orgId!, report.id, token!));
      await load();
    });
  }

  async function openReport(id: string) {
    await run(async () => {
      setOpen(await api.impact.getReport(orgId!, id, token!));
      setPurchase(await api.impact.reportPurchaseStatus(orgId!, id, token!));
    });
  }

  async function recompose() {
    if (!open) return;
    await run(async () => {
      await api.impact.composeReport(orgId!, open.id, token!);
      setOpen(await api.impact.getReport(orgId!, open.id, token!));
    });
  }

  /**
   * Send the admin to Stripe.
   *
   * Returning to this exact report rather than the list, because coming back
   * to "which one was I buying?" after paying $50 is its own small insult.
   */
  async function buy() {
    if (!open) return;
    await run(async () => {
      const here = `${window.location.origin}${window.location.pathname}`;
      const { url } = await api.impact.buyReport(
        orgId!,
        open.id,
        { successUrl: `${here}?report=${open.id}&paid=1`, cancelUrl: `${here}?report=${open.id}` },
        token!,
      );
      window.location.href = url;
    });
  }

  async function saveBlock(blockId: string) {
    if (!open) return;
    await run(async () => {
      await api.impact.updateReportBlock(orgId!, open.id, blockId, draft, token!);
      setOpen(await api.impact.getReport(orgId!, open.id, token!));
      setEditing(null);
    });
  }

  async function togglePublish() {
    if (!open) return;
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      if (open.status === 'PUBLISHED') await api.impact.unpublishReport(orgId, open.id, token);
      else await api.impact.publishReport(orgId, open.id, token);
      setOpen(await api.impact.getReport(orgId, open.id, token));
      await load();
    } catch (err) {
      // 402 is not a failure, it is the price. Rendering it as a red error
      // would tell an admin something broke when what happened is that they
      // have not bought it yet — so the panel below offers the purchase and
      // this stays quiet.
      if (err instanceof ApiError && err.status === 402) {
        setPurchase(await api.impact.reportPurchaseStatus(orgId, open.id, token));
      } else {
        setError(err instanceof Error ? err.message : 'That did not work');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (open) {
    const published = open.status === 'PUBLISHED';
    return (
      <div className="max-w-3xl space-y-6">
        <button
          onClick={() => { setOpen(null); setEditing(null); }}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All reports
        </button>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className={`rounded-xl border p-4 ${published ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{open.title}</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                {published ? 'Published — anyone with the link can read it.' : 'Draft — only organisers can see it.'}
                {/* G4, computed rather than claimed. */}
                {open.editedShare > 0 &&
                  ` You rewrote ${Math.round(open.editedShare * 100)}% of it.`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {published && orgSlug && (
                <a
                  href={`/portal/${orgSlug}/reports/${open.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm"
                >
                  <ExternalLink className="mr-1.5 inline h-4 w-4" />
                  View
                </a>
              )}
              <button onClick={togglePublish} disabled={busy} className={published ? 'btn-secondary text-sm' : 'btn-primary text-sm'}>
                {published ? 'Unpublish' : 'Publish'}
              </button>
            </div>
          </div>
          {published && (
            <p className="mt-3 border-t border-green-200 pt-3 text-xs text-green-800">
              {/* Said out loud, because silently editing something people have
                  been sent is the failure this rule exists to prevent. */}
              Editing is off while it is published — people may already be reading this. Unpublish
              to change it.
            </p>
          )}
        </div>

        {/* The prose, and how it is getting on (IMP-23). Written in the
            present tense about a report that already reads correctly — the
            written report is the free report until the rewrite lands over it,
            so none of these states is a broken document. */}
        {(open.composeStatus === 'PENDING' || open.composeStatus === 'COMPOSING') && (
          <p className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>
              MaybeOS is writing this up. It usually takes a few minutes — what you can read below
              is the plain version, and it will improve in place. Nothing is lost if you leave.
            </span>
          </p>
        )}

        {open.composeStatus === 'FAILED' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="flex max-w-md items-start gap-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <b>The writing did not come out right, so it was not used.</b>{' '}
                  {open.composeNote}
                  {' '}What you can read below is the plain version — every figure in it is correct.
                </span>
              </p>
              <button onClick={recompose} disabled={busy} className="btn-secondary shrink-0 text-sm">
                <RefreshCw className="mr-1.5 inline h-4 w-4" />
                Try again
              </button>
            </div>
          </div>
        )}

        {/* IMP-25: told, not asked. Everything that leaves has already passed
            suppression and is already public in the free report, and a consent
            gate would be the step between stating a goal and receiving a
            report that the PRD says must justify itself. So it is said
            plainly, where the writing happens, rather than buried in terms. */}
        {open.tier === 'WRITTEN' && (
          <p className="text-xs text-gray-500">
            Writing this sends your goals and your figures — the same ones anyone reading the
            published report can see — to Claude, the AI model MaybeOS uses. No member&rsquo;s
            answers, names or details ever leave MaybeOS.
          </p>
        )}

        {/* What the $50 is, said where the decision is made. Only ever shown
            on the written report: the basic one is free and offering to sell
            it would be taking money for something they already have. */}
        {purchase?.required && !purchase.paid && !published && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-md">
                <p className="flex items-center gap-1.5 font-medium text-amber-900">
                  <Lock className="h-4 w-4" />
                  Publishing this one costs {money(purchase.priceCents)}
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Read it, rewrite anything you disagree with, and pay when you are ready to send
                  it. The {money(purchase.priceCents)} covers this reporting period —{' '}
                  {new Date(purchase.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  {' to '}
                  {new Date(purchase.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  {' '}— including every version of it you publish afterwards.
                </p>
              </div>
              <button onClick={buy} disabled={busy} className="btn-primary shrink-0 text-sm">
                {busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
                Pay {money(purchase.priceCents)}
              </button>
            </div>
          </div>
        )}

        {purchase?.required && purchase.paid && !published && (
          <p className="flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <Check className="h-4 w-4 shrink-0" />
            Paid for. Publish and republish this period&rsquo;s report as often as you like.
          </p>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          {/* Editable blocks over the same renderer the public page uses, so
              what is approved here is exactly what a funder opens. */}
          <div className="space-y-8">
            {open.blocks.map((block) => (
              <div key={block.id} className="group relative">
                {editing === block.id ? (
                  <div>
                    {block.heading && <h2 className="text-lg font-semibold text-gray-900">{block.heading}</h2>}
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={6}
                      maxLength={5000}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => saveBlock(block.id)} disabled={busy} className="btn-primary text-sm">
                        <Check className="mr-1.5 inline h-4 w-4" />
                        Save
                      </button>
                      <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
                      {block.isEdited && block.generatedBody && (
                        <button
                          onClick={() => setDraft(block.generatedBody ?? '')}
                          className="text-xs text-gray-500 hover:text-gray-900"
                        >
                          Restore what MaybeOS wrote
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <ReportBody blocks={[block]} />
                    <div className="mt-1 flex items-center gap-3">
                      {!published && (
                        <button
                          onClick={() => { setEditing(block.id); setDraft(block.body ?? ''); }}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      )}
                      {block.isEdited && <span className="text-xs text-gray-400">edited by you</span>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="../impact" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" />
        Measuring
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Impact reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            What your members told you, written up — to send to a funder, a board, or your
            membership.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            The basic report is free, always. The full one is the same figures with the writing
            done for you; it is {money(WRITTEN_REPORT_PRICE_CENTS)} to publish, once per reporting
            period.
          </p>
        </div>
        {/* Both are free to make and free to read. The choice here is which
            report to look at, not what to buy — the price is named later, on
            the report itself, where the decision to send it is made. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          <button onClick={() => generate('BASIC')} disabled={busy} className="btn-secondary text-sm">
            {busy ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 inline h-4 w-4" />}
            Write the basic report
          </button>
          <button onClick={() => generate('WRITTEN')} disabled={busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 inline h-4 w-4" />}
            Write the full report
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {reports.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No reports yet. One can be written as soon as enough members have answered.
        </p>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => openReport(r.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-brand-400"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{r.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {new Date(r.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} –{' '}
                    {new Date(r.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {' · '}written {new Date(r.generatedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  {r.tier === 'WRITTEN' && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      Full
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.status === 'PUBLISHED' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {r.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
