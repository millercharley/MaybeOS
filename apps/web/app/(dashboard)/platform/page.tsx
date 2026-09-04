'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, ExternalLink, Loader2, Undo2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, PlatformOrg, PlatformSummary } from '@/lib/api';
import { money } from '@/lib/fees';
import { PageHeader } from '@/components/layout/page-header';

/**
 * The co-ops running on MaybeOS (PLT-01).
 *
 * **This page answers about co-ops, never about their members.** Until
 * 2026-08-20 `PLATFORM_ADMIN` was a bypass on every org-scoped guard in the
 * product — whoever ran MaybeOS could read any co-op's member list, DMs and
 * financial records, silently. Those bypasses are gone and this replaced
 * them: counts, plan, billing state, and one organiser to write to.
 *
 * Every action here is written to the co-op's own audit log, where its
 * organisers can read it. A support visit that leaves no trace is
 * indistinguishable from one that never happened.
 */
export default function PlatformPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [orgs, setOrgs] = useState<PlatformOrg[]>([]);
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, o] = await Promise.all([api.platform.summary(token), api.platform.orgs(token)]);
      setSummary(s);
      setOrgs(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the console');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (orgId: string, fn: () => Promise<unknown>) => {
    setBusy(orgId);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not take effect');
    } finally {
      setBusy(null);
    }
  };

  async function suspend(org: PlatformOrg) {
    const reason = window.prompt(
      `Suspend ${org.name}? Its members lose access immediately.\n\nThe reason is shown to its organizers in their own audit log:`,
    );
    if (!reason?.trim()) return;
    await run(org.id, () => api.platform.suspend(org.id, reason.trim(), token!));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (user?.globalRole !== 'PLATFORM_ADMIN' && error) {
    return (
      <div className="py-16 text-center">
        <PageHeader
          title="Platform administrators only"
          description="This console is not part of any co-op."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Co-ops on MaybeOS"
        />
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {/* Said on the page, because a console that quietly could see more
              than it says would be worse than one that says nothing. */}
          Counts, plans and billing. <b>Not members</b> — their names, emails and messages belong
          to their co-op, and nothing here can read them. Everything you do from this page is
          written to that co-op&apos;s own audit log.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {/* Loudest thing on the page when it is wrong, because everywhere else
          it is silent by design: attachments stop appearing, avatars never
          resolve, and the first report comes from a member (OPS-29). */}
      {summary?.storage && !summary.storage.reachable && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="flex items-center gap-2 font-medium text-red-900">
            <AlertTriangle className="h-4 w-4" />
            File storage is rejecting MaybeOS
          </p>
          <p className="mt-1 text-sm text-red-800">
            {summary.storage.configured
              ? `Supabase Storage answered ${summary.storage.httpStatus ?? 'an error'}. No logo, attachment or avatar can be stored on any co-op — and every one of those paths fails silently, so nobody will report it.`
              : 'No storage credentials are configured on this deployment.'}
          </p>
          <p className="mt-1 text-xs text-red-700">
            Fix: set <code>SUPABASE_SERVICE_ROLE_KEY</code> in Netlify to a key issued by this
            deployment&apos;s own Supabase project, then redeploy. This banner clears itself.
          </p>
        </div>
      )}

      {summary?.storage?.reachable && (
        <p className="text-xs text-gray-400">
          Storage reachable · {(summary.storage.buckets ?? []).join(', ')}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Co-ops', summary.orgs],
            ['Memberships', summary.memberships],
            ['Can take payments', summary.canTakePayments],
            ['Comped', summary.billingWaived],
            ['Suspended', summary.suspended],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-2xl font-bold tabular-nums text-gray-900">{value as number}</p>
              <p className="mt-0.5 text-xs text-gray-500">{label as string}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {orgs.map((org) => (
          <div
            key={org.id}
            className={`rounded-xl border bg-white p-5 ${org.suspendedAt ? 'border-red-200' : 'border-gray-200'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                  {org.name}
                  <a
                    href={org.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-brand-600"
                    aria-label={`Open ${org.name}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  {org.customDomain ?? org.url.replace('https://', '')}
                  {' · joined '}
                  {new Date(org.createdAt).toLocaleDateString()}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {org.memberCount} members · {org.eventCount} events · {org.roomCount} rooms
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Contact:{' '}
                  {org.contact ? (
                    <a href={`mailto:${org.contact.email}`} className="text-brand-600 hover:underline">
                      {org.contact.name ?? org.contact.email}
                    </a>
                  ) : (
                    <span className="text-amber-700">no organizer</span>
                  )}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm font-medium text-gray-900">
                  {org.plan}
                  {org.billingWaived && <span className="ml-1 text-green-700">· comped</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {money(org.transactionFeeCents)} per transaction
                </p>
                {org.planStatus && org.planStatus !== 'active' && (
                  <p className="text-xs text-amber-700">{org.planStatus.replace('_', ' ')}</p>
                )}
              </div>
            </div>

            {/* The two states that are invisible everywhere else in the
                product, and that a co-op does not know about itself. */}
            {(org.stripeHalfConnected || org.hasNoAdmin) && (
              <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                {org.stripeHalfConnected && (
                  <p className="flex items-start gap-1.5 text-sm text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Cannot take payments — Stripe onboarding was never finished. They may believe
                    they are selling tickets.
                  </p>
                )}
                {org.hasNoAdmin && (
                  <p className="flex items-start gap-1.5 text-sm text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    No organizer — nobody can reach its settings, billing or member list.
                  </p>
                )}
              </div>
            )}

            {org.suspendedAt && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                Suspended {new Date(org.suspendedAt).toLocaleDateString()} — {org.suspendedReason}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <select
                value={org.plan}
                onChange={(e) => run(org.id, () => api.platform.setPlan(org.id, { plan: e.target.value }, token!))}
                disabled={busy === org.id}
                aria-label={`Plan for ${org.name}`}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="FREE">FREE</option>
                <option value="PLUS">PLUS</option>
                <option value="UNLIMITED">UNLIMITED</option>
              </select>

              <button
                onClick={() =>
                  run(org.id, () =>
                    api.platform.setPlan(
                      org.id,
                      {
                        billingWaived: !org.billingWaived,
                        reason: org.billingWaived ? undefined : 'Comped from the console',
                      },
                      token!,
                    ),
                  )
                }
                disabled={busy === org.id}
                className="btn-secondary text-sm"
                // The distinction that matters, and the reason this is two
                // switches: comping by moving a co-op to FREE would triple
                // its members' ticket fees.
                title="Stop charging for the plan they are on. Their ticket fee follows the plan as normal."
              >
                {org.billingWaived ? 'Charge again' : 'Give free'}
              </button>

              {org.suspendedAt ? (
                <button
                  onClick={() => run(org.id, () => api.platform.restore(org.id, token!))}
                  disabled={busy === org.id}
                  className="btn-secondary text-sm"
                >
                  <Undo2 className="mr-1.5 inline h-4 w-4" />
                  Restore
                </button>
              ) : (
                <button
                  onClick={() => suspend(org)}
                  disabled={busy === org.id}
                  className="text-sm text-gray-400 hover:text-red-600"
                >
                  <Ban className="mr-1 inline h-3.5 w-3.5" />
                  Suspend
                </button>
              )}

              {busy === org.id && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
            </div>
          </div>
        ))}
      </div>

      <p className="max-w-2xl text-xs text-gray-400">
        {/* Stated because it is the design, not an omission somebody should
            file a ticket about. */}
        Suspending stops access and deletes nothing. Nothing on this page can make somebody a
        platform administrator — a role that can grant itself is not a role, so it is set outside
        the product. <Check className="inline h-3 w-3" /> Every change here is recorded in the
        co-op&apos;s audit log.
      </p>
    </div>
  );
}
