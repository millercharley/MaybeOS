'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Trash2, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, Location } from '@/lib/api';

/**
 * Where the co-op is (ORG-01).
 *
 * The landing page opens OrgOS with the word "Locations" and there has never
 * been an interface for one: a `Location` model since the foundation, a single
 * create endpoint, and no caller anywhere in the product. Rooms and events
 * both carry a nullable `locationId` that has therefore always been null —
 * which is exactly why nobody noticed, since everything works without it.
 */
export function Locations({ orgId }: { orgId: string }) {
  const token = useAuthStore((s) => s.token);

  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', address: '', city: '', state: '', zip: '' });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setLocations(await api.orgs.locations(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load locations');
    } finally {
      setLoading(false);
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!draft.name.trim() || !token) return;
    setBusy(true);
    setError('');
    try {
      await api.orgs.addLocation(orgId, { ...draft, name: draft.name.trim() }, token);
      setDraft({ name: '', address: '', city: '', state: '', zip: '' });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await api.orgs.removeLocation(orgId, id, token!);
      await load();
    } catch (err) {
      // The refusal is the useful message here — it names how many rooms and
      // events still point at it, so this is shown rather than swallowed.
      setError(err instanceof Error ? err.message : 'Could not remove that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
        <p className="mt-1 text-sm text-gray-500">
          The places your co-op actually is. Rooms and events can each say which one they&apos;re
          at — useful once there is more than one, and harmless when there isn&apos;t.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
      ) : (
        <ul className="space-y-2">
          {locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                  {l.name}
                </p>
                {(l.address || l.city) && (
                  <p className="mt-0.5 text-sm text-gray-500">
                    {[l.address, l.city, l.state, l.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {((l.roomCount ?? 0) > 0 || (l.eventCount ?? 0) > 0) && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {l.roomCount ?? 0} {l.roomCount === 1 ? 'room' : 'rooms'} ·{' '}
                    {l.eventCount ?? 0} {l.eventCount === 1 ? 'event' : 'events'}
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(l.id)}
                disabled={busy}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                aria-label={`Remove ${l.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Butchertown Hall"
            maxLength={120}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder="Street address"
            maxLength={200}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex gap-2">
            <input
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              placeholder="City"
              maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <input
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              placeholder="State"
              maxLength={60}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <input
              value={draft.zip}
              onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
              placeholder="ZIP"
              maxLength={20}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={busy || !draft.name.trim()} className="btn-primary text-sm">Add</button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-secondary text-sm">
          <Plus className="mr-1.5 inline h-4 w-4" />
          Add a location
        </button>
      )}
    </section>
  );
}
