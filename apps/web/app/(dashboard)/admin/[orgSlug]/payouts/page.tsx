'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Undo2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, HostPayoutPreview } from '@/lib/api';
import { money } from '@/lib/fees';

/**
 * Paying members who hosted events and sold tickets (EVT-15).
 *
 * The money is already in the co-op's Stripe account — MaybeOS never holds
 * anybody's takings (D-013) — so this page works out what each host is owed
 * and records that it was paid. **The co-op sends the money itself**, however
 * it already pays people, which is said on the page rather than left to be
 * inferred from a button that does less than it looks like it does.
 */
export default function PayoutsPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [rows, setRows] = useState<HostPayoutPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setRows(await api.events.hostPayouts(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payouts');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function markPaid(eventId: string) {
    setBusy(eventId);
    setError('');
    try {
      await api.events.markPayoutPaid(orgId!, eventId, note[eventId] ?? '', token!);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not record');
    } finally {
      setBusy(null);
    }
  }

  async function undo(eventId: string) {
    setBusy(eventId);
    try {
      await api.events.cancelPayout(orgId!, eventId, token!);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not record');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const owed = rows.filter((r) => r.payout?.status !== 'PAID' && r.amountCents > 0);
  const settled = rows.filter((r) => r.payout?.status === 'PAID');

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Host payouts</h1>
        <p className="mt-1 text-sm text-gray-500">
          {/* Said plainly: the button records, it does not send. */}
          What each member who hosted an event is owed from its ticket sales. MaybeOS works out
          the amount — <b>you send the money the way you already pay people</b>, then mark it here.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {owed.length === 0 && settled.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          Nothing owed yet. This fills in when a member hosts an event that sells tickets.
        </p>
      )}

      {owed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Owed</h2>
          {owed.map((row) => (
            <div key={row.eventId} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{row.title}</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {row.host?.name ?? 'No host'} · {new Date(row.endTime).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {row.ticketCount} {row.ticketCount === 1 ? 'ticket' : 'tickets'} ={' '}
                    {money(row.grossCents)}
                    {row.shareBps !== 10000 && ` · host keeps ${row.shareBps / 100}%`}
                    {row.refundedCount > 0 && ` · ${row.refundedCount} refunded and excluded`}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold tabular-nums text-gray-900">
                  {money(row.amountCents)}
                </p>
              </div>

              {row.hasEnded ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <input
                    value={note[row.eventId] ?? ''}
                    onChange={(e) => setNote((n) => ({ ...n, [row.eventId]: e.target.value }))}
                    placeholder="How you sent it — bank transfer, cash…"
                    maxLength={200}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    onClick={() => markPaid(row.eventId)}
                    disabled={busy === row.eventId}
                    className="btn-primary shrink-0 text-sm"
                  >
                    <Check className="mr-1.5 inline h-4 w-4" />
                    Mark paid
                  </button>
                </div>
              ) : (
                // Refusing early is the point, so it says why rather than
                // just greying out.
                <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-amber-700">
                  This event hasn&apos;t finished. Tickets can still be sold or refunded, so what is
                  owed isn&apos;t final yet.
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {settled.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Paid</h2>
          {settled.map((row) => (
            <div key={row.eventId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{row.title}</p>
                <p className="text-xs text-gray-500">
                  {row.host?.name} · {money(row.payout!.amountCents)}
                  {row.payout!.paidAt && ` · ${new Date(row.payout!.paidAt).toLocaleDateString()}`}
                  {row.payout!.note && ` · ${row.payout!.note}`}
                </p>
              </div>
              <button
                onClick={() => undo(row.eventId)}
                disabled={busy === row.eventId}
                className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                title="Marked in error"
              >
                <Undo2 className="mr-1 inline h-3 w-3" />
                Undo
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
