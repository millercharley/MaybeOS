'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether members may broadcast what they teach (TCH-01).
 *
 * Saves immediately, like the switches beside it: a control that looks
 * flipped but has not been saved leaves an admin believing their members can
 * post a workshop when they cannot.
 *
 * **Turning it off hides the feature; it deletes nothing.** Offerings and
 * their sessions stay in the database, the nav item goes, the pages refuse
 * and the public page answers an empty list. Switching it back on brings
 * everything back exactly as it was — which is what an admin expects from a
 * switch, and the reason the API refuses rather than cascading.
 *
 * The one thing worth saying on screen is about the sessions, because it is
 * the part that surprises people: a workshop's dates are ordinary events and
 * they stay on the calendar either way. Somebody who has bought a ticket to
 * next Tuesday still has one.
 */
export function TeachingToggle({
  org,
  orgSlug,
  onChange,
}: {
  org: Org;
  orgSlug: string;
  onChange?: (enabled: boolean) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [enabled, setEnabled] = useState(Boolean(org.teachingEnabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(next: boolean) {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      await api.orgs.update(org.id, { teachingEnabled: next }, token);
      setEnabled(next);
      onChange?.(next);
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
          <h2 className="text-base font-semibold text-gray-900">Teaching</h2>
          <p className="mt-1 text-sm text-gray-500">
            {enabled
              ? 'Members can post a workshop or offer private lessons, and say whether they are open to the public.'
              : 'Members cannot post workshops or offer lessons. Nothing about teaching appears anywhere.'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => save(!enabled)}
          disabled={saving}
          className={enabled ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
        >
          {saving ? 'Saving...' : enabled ? 'Turn teaching off' : 'Turn teaching on'}
        </button>
        {enabled && (
          <Link
            href={`/admin/${orgSlug}/teaching`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            See what is on offer
          </Link>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Turning this off hides teaching and deletes nothing — switch it back on and everything
        returns. A workshop&rsquo;s dates are ordinary events either way, so they stay on the
        calendar and anybody holding a ticket keeps it.
      </p>
    </section>
  );
}
