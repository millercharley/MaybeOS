'use client';

import { useState } from 'react';
import { HandHelping } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * What the co-op says an hour of a member's service is worth (SRV-02).
 *
 * Blank by default and blank is a real answer, not an unfinished form. ImpactOS
 * reports hours either way; setting this adds a dollar figure to the report,
 * and that figure is the co-op's assertion — MaybeOS deliberately supplies no
 * default, because a number it chose would be asserted in the co-op's name in
 * a document a funder reads.
 */
export function ServiceValue({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [rate, setRate] = useState(
    org.volunteerHourValueCents ? (org.volunteerHourValueCents / 100).toFixed(2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!token || !orgId) return;

    const trimmed = rate.trim();
    // Explicit null, so clearing the box removes the figure from the report
    // rather than leaving the old rate quietly in place.
    let cents: number | null = null;
    if (trimmed) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Enter an hourly amount, or leave it blank for none.');
        return;
      }
      cents = Math.round(parsed * 100);
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.orgs.update(orgId, { volunteerHourValueCents: cents }, token);
      setMessage(cents === null ? 'Cleared. Reports will state hours only.' : 'Saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card max-w-2xl space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-gray-900">
          <HandHelping className="h-4 w-4 text-gray-400" />
          What an hour of service is worth
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Your impact report always states the hours members gave. If you set a rate here,
          it will also state what that comes to — and say the rate is yours.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Per hour</span>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input w-32"
            placeholder="None"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <button onClick={save} disabled={busy} className="btn-secondary">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <span className="mt-1 block text-xs text-gray-500">
          Leave it blank and the report states hours only, which needs no assumption to be
          true. MaybeOS will not pick a figure for you: a funder may ask where the rate
          came from, and the answer has to be your co-op rather than your software.
        </span>
      </label>

      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
