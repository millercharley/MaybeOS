'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, ConnectStatus, Org } from '@/lib/api';

/**
 * Getting paid for tickets (D-013).
 *
 * Two things live here because they are the same decision from the admin's
 * side: connecting a Stripe account so the co-op can take money at all, and
 * choosing whether to add a fee of its own on top of MaybeOS's.
 *
 * The honesty this screen owes an admin:
 *
 *   - **The co-op is the merchant.** Money goes to their Stripe account, not
 *     MaybeOS's, and Stripe pays them on their own schedule.
 *   - **What MaybeOS takes**, in cents, by their plan — no "fees may apply".
 *   - **What a refund costs them**, because Stripe keeps its processing fee
 *     and a cancelled sold-out event is money out of the co-op's pocket.
 */

const PLATFORM_FEE_CENTS: Record<string, number> = { FREE: 55, PLUS: 30, UNLIMITED: 10 };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function TicketPayouts({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState(((org.ticketFeeCents ?? 0) / 100).toFixed(2));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setStatus(await api.connect.status(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check payment setup');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      const here = window.location.href;
      const { url } = await api.connect.startOnboarding(
        orgId,
        { returnUrl: here, refreshUrl: here },
        token,
      );
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup');
      setBusy(false);
    }
  }

  async function saveFee() {
    if (!token || !orgId) return;
    const cents = Math.round(Number(fee) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('That fee is not a number.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.orgs.update(orgId, { ticketFeeCents: cents }, token);
      setMessage('Saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  const platformFee = PLATFORM_FEE_CENTS[org.plan ?? 'FREE'] ?? 55;
  const ready = status?.chargesEnabled;

  return (
    <section className="card max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Ticket sales</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sell tickets to your events. Money goes to your own Stripe account —
            MaybeOS never holds it — and Stripe pays you on your usual schedule.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            ready ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {loading ? 'Checking...' : ready ? 'Ready' : 'Not set up'}
        </span>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>
      )}

      {!loading && !ready && (
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-700">
            {status?.connected
              ? 'Stripe still needs a few details before you can be paid.'
              : 'Connect a Stripe account to start selling tickets.'}
          </p>
          {status?.requirements && status.requirements.length > 0 && (
            // Stripe names what is outstanding; showing it beats "not ready".
            <ul className="mt-2 list-inside list-disc text-xs text-gray-500">
              {status.requirements.slice(0, 5).map((r) => (
                <li key={r}>{r.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="btn-primary mt-3 inline-flex items-center gap-2 text-sm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {status?.connected ? 'Finish setup on Stripe' : 'Connect Stripe'}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {ready && (
        <p className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          Your Stripe account is connected and can take payments.
        </p>
      )}

      <div className="border-t border-gray-200 pt-4">
        <label htmlFor="ticket-fee" className="block text-sm font-medium text-gray-900">
          Your fee per ticket
        </label>
        <p className="mt-1 text-sm text-gray-500">
          Added on top of the ticket price, alongside the{' '}
          <strong>{money(platformFee)}</strong> MaybeOS fee on your{' '}
          {(org.plan ?? 'FREE').toLowerCase()} plan. Leave it at zero to charge nothing
          extra.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-gray-500">$</span>
          <input
            id="ticket-fee"
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="input w-28"
          />
          <button type="button" onClick={saveFee} disabled={busy} className="btn-secondary text-sm">
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          On a $10 ticket a buyer would pay{' '}
          <strong>{money(1000 + platformFee + Math.round(Number(fee || '0') * 100))}</strong>. You
          receive the $10.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          If you cancel an event, everyone is refunded in full including the MaybeOS
          fee — but Stripe keeps its processing fee on refunds, so cancelling a
          sold-out event costs you money.
        </p>
      </div>
    </section>
  );
}
