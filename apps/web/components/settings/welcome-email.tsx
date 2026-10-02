'use client';

import { useState } from 'react';
import { Org, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether MaybeOS welcomes a new member itself (MEM-17).
 *
 * Off until a co-op says otherwise, and the copy says why rather than
 * treating it as an oversight: a co-op arriving from another system usually
 * already has something sending this. MaybeItsFate's came from a Zapier
 * automation wired to Stripe, and it welcomed Charley to the old system in
 * the middle of testing the new one — two welcomes being considerably worse
 * than none.
 *
 * Saves on change, like the other switches that decide whether email leaves
 * the building. Bundling it into a save-everything button would let an
 * organizer leave the page believing it was on when it was not.
 */
export function WelcomeEmail({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const on = org.welcomeEmailEnabled ?? false;

  async function toggle() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.orgs.update(org.id, { welcomeEmailEnabled: !on }, token);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Welcome email</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            When somebody becomes a member — by joining or by accepting an invitation — MaybeOS
            emails them a welcome in your community&rsquo;s name, with a link to their member
            page. People brought in by a spreadsheet import are never emailed: they didn&rsquo;t
            just arrive.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            on ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {on ? 'On' : 'Off'}
        </span>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {!on && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          If something else already welcomes your new members — a Zapier automation, your old
          platform, a mail tool — turn that off first. Two welcome emails are worse than none.
        </div>
      )}

      <button type="button" onClick={toggle} disabled={busy} className="btn-secondary text-sm">
        {on ? 'Stop sending the welcome' : 'Send a welcome to new members'}
      </button>
    </section>
  );
}
