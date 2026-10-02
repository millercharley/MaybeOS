'use client';

import { useState } from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Where members who joined before MaybeOS still pay (MIG-03).
 *
 * A co-op migrating in brings its members before it brings its money.
 * MaybeItsFate imported 426 people and every one of them is still charged by
 * the Stripe account they originally signed up through — so their Dues &
 * billing page offered a tier to buy and said nothing at all about the money
 * already leaving their account every month.
 *
 * Blank is the ordinary answer and the default. A co-op that started on
 * MaybeOS has no previous billing and must not show its members a link to one.
 */
export function LegacyBilling({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [url, setUrl] = useState(org.legacyBillingUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!token || !orgId) return;
    const value = url.trim();

    // Checked here so somebody sees it before a round trip; the server
    // refuses it too, because this link is handed to every imported member as
    // the place to go about money.
    if (value && !/^https:\/\//i.test(value)) {
      setError('That needs to be a full https:// address.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.orgs.update(orgId, { legacyBillingUrl: value || null }, token);
      setMessage(
        value
          ? 'Saved. Members you imported now see a link to it on their billing page.'
          : 'Cleared. Nobody is shown a link to previous billing any more.',
      );
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <CreditCard className="h-5 w-5 text-[var(--text-tertiary)]" />
        <h2 className="font-semibold">Billing for imported members</h2>
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        If your members were paying dues somewhere else before they arrived here, give
        MaybeOS the address where they manage that payment — a Stripe customer portal,
        or whatever your old system used. Members MaybeOS is not yet billing see a link
        to it on their Dues &amp; billing page, so nobody has to ask whether they are
        now paying twice.
      </p>

      <p className="mt-2 text-sm text-[var(--text-tertiary)]">
        It disappears for each member on its own, as soon as their dues move to MaybeOS.
        Leave it blank if your co-op started here.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://billing.stripe.com/p/login/…"
          className="min-w-[18rem] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {url.trim().startsWith('https://') && (
          <a
            href={url.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] underline"
          >
            Open it
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-[var(--success)]">{message}</p>}
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
