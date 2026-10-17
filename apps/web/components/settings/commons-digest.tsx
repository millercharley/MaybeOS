'use client';

import { useState } from 'react';
import { Org, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The weekly Commons digest (CMN-20).
 *
 * Off until a co-op turns it on, like every other switch that decides
 * whether email leaves the building — a co-op that migrated last week should
 * not discover MaybeOS emailing its roster because a deploy happened.
 *
 * The copy leads with who receives it, because that is the thing an
 * organiser will otherwise get wrong: this is not a newsletter to the
 * community, it is a letter to the people who have stopped coming. On a
 * co-op that reads its own Commons it sends almost nothing, and that is the
 * feature working rather than failing.
 *
 * Saves on change, like the other email switches. Bundling it into a
 * save-everything button would let an organiser leave the page believing it
 * was on when it was not.
 */
export function CommonsDigest({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const on = org.commonsDigestEnabled ?? false;
  const day = org.commonsDigestDay ?? 1;
  const hour = org.commonsDigestHour ?? 9;

  async function save(changes: Partial<Org>) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.orgs.update(org.id, changes, token);
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
          <h2 className="text-base font-semibold text-gray-900">What members missed</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            Once a week, MaybeOS emails a short summary of the Commons to members who
            haven&rsquo;t been in at all that week — not to everyone. Somebody who read a
            channel, opened a message or posted anything gets nothing, because they
            didn&rsquo;t miss it. On an active community this sends very few.
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

      {on && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="digest-day" className="label">
              Sent on
            </label>
            <select
              id="digest-day"
              value={day}
              disabled={busy}
              onChange={(e) => save({ commonsDigestDay: Number(e.target.value) })}
              className="input mt-1"
            >
              {DAYS.map((name, value) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="digest-hour" className="label">
              At
            </label>
            <select
              id="digest-hour"
              value={hour}
              disabled={busy}
              onChange={(e) => save({ commonsDigestHour: Number(e.target.value) })}
              className="input mt-1"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">In your community&rsquo;s own timezone.</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => save({ commonsDigestEnabled: !on })}
        disabled={busy}
        className="btn-secondary text-sm"
      >
        {on ? 'Stop sending the weekly summary' : 'Send a weekly summary to members who are away'}
      </button>
    </section>
  );
}
