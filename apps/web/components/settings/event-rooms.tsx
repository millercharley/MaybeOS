'use client';

import { useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether an event has to say which room it is in (SPC-27).
 *
 * Charley asked for a switch to "enforce events to connect to room
 * reservation". A co-op that runs a building wants its calendar and its room
 * sheet to agree — an event nobody booked a room for is either in a room
 * somebody else has, or not really happening.
 *
 * Off by default, because off is right for most co-ops and because turning it
 * on does not make existing events invalid: it is checked when an event is
 * published, not when one is read.
 */
export function EventRooms({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [on, setOn] = useState(Boolean(org.requireEventRoom));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: boolean) {
    if (!token || !orgId) return;
    setOn(next);
    setBusy(true);
    setError('');
    try {
      await api.orgs.update(orgId, { requireEventRoom: next }, token);
      onSaved?.();
    } catch (err) {
      setOn(!next);
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <DoorOpen className="h-5 w-5 text-[var(--text-tertiary)]" />
        <h2 className="font-semibold">Events and rooms</h2>
      </div>

      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => change(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900">
            Every event must name a room reservation
          </span>
          <span className="mt-0.5 block text-[var(--text-secondary)]">
            Hosts pick the booking that holds the room before they can publish. Turn this on
            if your co-op runs a building and you want the calendar and the room sheet to
            agree. Leave it off if your events happen anywhere — a park, somebody&apos;s front
            room, online.
          </span>
        </span>
      </label>

      <p className="mt-3 text-xs text-[var(--text-tertiary)]">
        It applies when an event is published, so nothing already on your calendar is
        affected. A host with no booking yet is told to make one.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
