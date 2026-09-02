'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { api, ApiError, type Room } from '@/lib/api';
import {
  WEEKDAYS,
  problemWith,
  rulesFromWeek,
  summarise,
  weekFromRules,
  type Week,
} from '@/lib/room-hours';

/**
 * When a room is open (SPC-11).
 *
 * The rules endpoint has existed since SpaceOS was built and nothing had ever
 * called it, so an organiser's only two options were "always available" and
 * "unbookable" — and a room left at the default was the second one, silently.
 * The Attic sat like that with a connected Google Calendar and a booking
 * screen that could only say it had no hours.
 *
 * Edited as a week rather than as rules. The API stores a list with optional
 * weekdays, which is the right thing to evaluate a booking against and a
 * miserable thing to fill in; an organiser thinks "Tuesday to Saturday, ten
 * till six".
 */
export function RoomHours({
  room,
  orgId,
  token,
  onSaved,
}: {
  room: Room;
  orgId: string;
  token: string;
  onSaved: () => void;
}) {
  const stored = weekFromRules(room.availabilityRules);
  const [week, setWeek] = useState<Week>(stored);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (index: number, patch: Partial<Week[number]>) =>
    setWeek(week.map((day, i) => (i === index ? { ...day, ...patch } : day)));

  const copyDownFrom = (index: number) =>
    setWeek(
      week.map((day, i) =>
        i > index && day.open ? { ...day, from: week[index].from, to: week[index].to } : day,
      ),
    );

  async function save() {
    const problem = problemWith(week);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError('');
    try {
      // One call, one transaction. Deleting and creating rule by rule from
      // here was eleven round trips, and a failure halfway left the room with
      // its old hours gone and its new ones unwritten — a room that opens at
      // nine turning into one nobody can book, with nothing saying so.
      await api.rooms.replaceHours(orgId, room.id, rulesFromWeek(week), token);

      onSaved();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save the hours. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setWeek(weekFromRules(room.availabilityRules));
          setOpen(true);
        }}
        className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Clock size={14} aria-hidden="true" />
        <span>
          {room.alwaysAvailable ? 'Always available' : summarise(stored)}
          <span className="ml-2 underline">Edit hours</span>
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] p-4">
      <h4 className="font-medium">Bookable hours</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Times are {room.name}&apos;s local clock — the co-op&apos;s timezone, not the
        member&apos;s. A room with no hours and &ldquo;always available&rdquo; switched off
        cannot be booked at all.
      </p>

      {room.alwaysAvailable && (
        <p className="mt-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          This room is marked always available, so these hours are ignored. Untick that to use
          them.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {WEEKDAYS.map((name, index) => (
          <li key={name} className="flex flex-wrap items-center gap-2">
            <label className="flex w-32 shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={week[index].open}
                onChange={(e) => set(index, { open: e.target.checked })}
              />
              {name}
            </label>

            {week[index].open ? (
              <>
                <input
                  type="time"
                  aria-label={`${name} opens`}
                  className="input w-32"
                  value={week[index].from}
                  onChange={(e) => set(index, { from: e.target.value })}
                />
                <span className="text-[var(--text-tertiary)]">to</span>
                <input
                  type="time"
                  aria-label={`${name} closes`}
                  className="input w-32"
                  value={week[index].to}
                  onChange={(e) => set(index, { to: e.target.value })}
                />
                {index < 6 && (
                  <button
                    onClick={() => copyDownFrom(index)}
                    className="btn-ghost text-xs"
                    title="Use these times for the open days below"
                  >
                    Copy down
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm text-[var(--text-tertiary)]">Closed</span>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save hours'}
        </button>
        <button onClick={() => setOpen(false)} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
