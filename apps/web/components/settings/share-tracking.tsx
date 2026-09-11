'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether the co-op tracks shares and ownership (MEM-19).
 *
 * Saves immediately, like the public-join switch beside it: a control that
 * looks flipped but has not been saved would leave an admin believing
 * members could see holdings, or could not, when the opposite was true.
 *
 * Turning it on asks once — every member will see every member's holding.
 * Turning it off does not: hiding figures is always safe and should never
 * carry friction. Nothing recorded is deleted either way.
 *
 * The current state is read from the Members endpoint, which reports it,
 * rather than the public org route — that one answers anybody, and whether a
 * co-op keeps an equity register is not the internet's business.
 */
export function ShareTracking({ orgId, orgName, orgSlug }: { orgId: string; orgName: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.ledger
      .get(orgId, token)
      .then((ledger) => setEnabled(ledger.sharesEnabled))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read this setting.'));
  }, [orgId, token]);

  async function save(next: boolean) {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      await api.orgs.update(orgId, { sharesEnabled: next }, token);
      setEnabled(next);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Shares &amp; ownership</h2>
          <p className="mt-1 text-sm text-gray-500">
            {enabled
              ? 'Every member sees each member’s shares and share of the co-op on the Members page.'
              : 'Off. The Members page is a directory, with no shares or ownership shown.'}
          </p>
        </div>
        {enabled !== null && (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {enabled ? 'Tracking shares' : 'Off'}
          </span>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {confirming ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Show shares and ownership to every member of {orgName}?</p>
          <p className="mt-1 text-sm text-amber-800">
            Each member will see what every member holds, and what share of the co-op that is. You can
            turn it off again at any time, and nothing you record is lost if you do.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Saving...' : 'Yes, track shares'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        enabled !== null && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => (enabled ? save(false) : setConfirming(true))}
              disabled={saving}
              className={enabled ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
            >
              {saving ? 'Saving...' : enabled ? 'Turn off' : 'Track shares and ownership'}
            </button>
            {enabled && (
              <Link href={`/admin/${orgSlug}/shares`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Manage shares
              </Link>
            )}
          </div>
        )
      )}
    </section>
  );
}
