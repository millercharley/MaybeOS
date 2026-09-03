'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { ApiError, type Closure } from '@/lib/api';
import { closureLabel } from '@/lib/room-closures';

/**
 * When a room is shut (SPC-18).
 *
 * The slot engine has subtracted blackout rules from opening hours since
 * SPC-15 and nothing in the product could create one, so "closed for the
 * holidays" was unsayable — a co-op's only option was to edit its opening
 * hours in December and remember to put them back.
 *
 * Dates are sent as calendar dates and never as instants. The co-op's timezone
 * is the server's to apply: an organiser travelling would otherwise close the
 * room on the wrong day.
 */
export interface ClosureStore {
  list: () => Promise<Closure[]>;
  add: (closure: {
    fromDate: string;
    toDate?: string;
    startTime?: string;
    endTime?: string;
    label?: string;
  }) => Promise<unknown>;
  remove: (closureId: string) => Promise<unknown>;
}

export function ClosureEditor({
  what,
  heading,
  blurb,
  store,
  onChanged,
}: {
  /** What is being closed, for the confirmation: "the Attic", "the building". */
  what: string;
  heading: string;
  blurb: string;
  store: ClosureStore;
  onChanged?: () => void;
}) {
  const [closures, setClosures] = useState<Closure[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [label, setLabel] = useState('');

  // Held in a ref because callers build `store` inline, so it is a fresh
  // object on every render. Depending on it directly would make `load` change
  // every render, and the effect below would refetch in a loop for as long as
  // the page was open.
  const storeRef = useRef(store);
  storeRef.current = store;

  const load = useCallback(async () => {
    try {
      setClosures(await storeRef.current.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the closures.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setFrom('');
    setTo('');
    setAllDay(true);
    setStart('09:00');
    setEnd('17:00');
    setLabel('');
    setAdding(false);
  }

  async function add() {
    if (!from) {
      setError('A closure needs at least a first day.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await storeRef.current.add(
        {
          fromDate: from,
          // Omitted rather than sent equal: a single day is the common case
          // and the server already treats a missing end as "that day".
          ...(to && to !== from ? { toDate: to } : {}),
          ...(allDay ? {} : { startTime: start, endTime: end }),
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      );
      reset();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that closure.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(closure: Closure) {
    if (!window.confirm(`Reopen ${what} for ${closureLabel(closure)}?`)) return;

    setBusy(true);
    setError('');
    try {
      await storeRef.current.remove(closure.id);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that closure.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
      <h4 className="flex items-center gap-2 font-medium">
        <CalendarOff size={14} aria-hidden="true" />
        {heading}
      </h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{blurb}</p>

      {closures === null ? (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Loading…</p>
      ) : closures.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Nothing scheduled. {what.charAt(0).toUpperCase() + what.slice(1)} follows the usual
          hours.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {closures.map((closure) => (
            <li
              key={closure.id}
              className="flex items-center justify-between gap-3 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-sm"
            >
              <span>
                {closure.label ? <strong>{closure.label}</strong> : 'Closed'}
                <span className="text-[var(--text-secondary)]"> · {closureLabel(closure)}</span>
              </span>
              <button
                onClick={() => remove(closure)}
                disabled={busy}
                className="btn-ghost"
                aria-label={`Remove closure ${closureLabel(closure)}`}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium">First day</span>
              <input
                type="date"
                className="input mt-1"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Last day</span>
              <input
                type="date"
                className="input mt-1"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
              <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
                Leave blank for one day
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            Closed all day
          </label>

          {!allDay && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                aria-label="Closed from"
                className="input w-32"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <span className="text-[var(--text-tertiary)]">to</span>
              <input
                type="time"
                aria-label="Closed until"
                className="input w-32"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium">Reason</span>
            <input
              type="text"
              className="input mt-1 w-full"
              placeholder="Winter break"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
              Shown to members. Without one they only see that the room is shut.
            </span>
          </label>

          <div className="flex gap-2">
            <button onClick={add} disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : `Close ${what}`}
            </button>
            <button onClick={reset} disabled={busy} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-secondary mt-3 inline-flex items-center gap-2">
          <Plus size={14} aria-hidden="true" />
          Add a closed period
        </button>
      )}

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
