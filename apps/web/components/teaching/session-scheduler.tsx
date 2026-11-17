'use client';

import { useState, FormEvent } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Putting a date on a workshop (TCH-01).
 *
 * The date becomes an `Event`, which is the whole design: from the moment it
 * is saved it is on the co-op's calendar, in the ICS feed, able to take RSVPs
 * and — if the teacher priced it — able to sell tickets, all through
 * machinery that already exists and is already tested.
 *
 * **Deliberately the short form.** Title, when, and how many; everything else
 * an event can carry is set afterwards on the event's own screen, which has
 * the room picker, the image, the co-hosts and the ticket settings. Rebuilding
 * any of that here would be a second event form to keep in step with the
 * first, and the first is 440 lines of DTO.
 *
 * Visibility is *not* asked for. A session inherits its offering's, server
 * side — a members-only workshop whose dates were public would be a leak made
 * by a dropdown nobody read.
 */
export function SessionScheduler({
  orgId,
  offeringId,
  token,
  onAdded,
}: {
  orgId: string;
  offeringId: string;
  token: string;
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');

    /*
      Checked here as well as by the API, because the message can be better:
      the server says a date is invalid, and this can say which way round it
      went. Never blames the reader (DESIGN §8).
    */
    if (new Date(end) <= new Date(start)) {
      setError('The finish needs to be after the start.');
      return;
    }

    setBusy(true);
    try {
      await api.teaching.addSession(
        orgId,
        offeringId,
        {
          title: title.trim(),
          startTime: new Date(start).toISOString(),
          endTime: new Date(end).toISOString(),
          ...(capacity.trim() ? { capacity: Number(capacity) } : {}),
        },
        token,
      );
      setTitle('');
      setStart('');
      setEnd('');
      setCapacity('');
      setOpen(false);
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That date did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary text-sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="mr-1.5 inline h-4 w-4" aria-hidden />
        Add a date
      </button>
    );
  }

  return (
    <form onSubmit={add} className="space-y-3">
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-sm text-[var(--text-secondary)]">
          What this session is called
        </span>
        <input
          className="input w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Week one: centring"
          required
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--text-secondary)]">Starts</span>
          <input
            type="datetime-local"
            className="input w-full"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--text-secondary)]">Finishes</span>
          <input
            type="datetime-local"
            className="input w-full"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="block sm:max-w-[12rem]">
        <span className="mb-1 block text-sm text-[var(--text-secondary)]">
          How many people <span className="opacity-70">Optional.</span>
        </span>
        <input
          className="input w-full"
          inputMode="numeric"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))}
          placeholder="8"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-secondary text-sm" disabled={busy}>
          {busy ? 'Adding…' : 'Add it to the calendar'}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      <p className="text-sm text-[var(--text-tertiary)]">
        It goes on the co-op&rsquo;s calendar straight away, with the same audience as this
        offering. Rooms, tickets and the rest are on the event&rsquo;s own page afterwards.
      </p>
    </form>
  );
}
