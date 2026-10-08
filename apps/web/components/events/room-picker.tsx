'use client';

import { useEffect, useState } from 'react';
import { DoorOpen, Loader2 } from 'lucide-react';
import { api, type AttachableBooking } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Attaching a room reservation to an event (SPC-27).
 *
 * Charley: "if the system isn't aware of what room is being used, ask in the
 * Event creation to search for a room reservation — the user can only see
 * rooms they or a co-host has reserved (ask for co-host first)."
 *
 * So this lists rather than searches. A member has a handful of reservations
 * near the date, not hundreds; showing them is faster than asking them to
 * describe one. The API decides whose are offered, and a reservation
 * belonging to somebody who is not running the event is simply not there —
 * which is why the co-host field sits above this one.
 */
export function RoomPicker({
  orgId,
  eventId,
  picked,
  onPick,
  onDrop,
  fixedId,
}: {
  orgId: string;
  eventId?: string;
  picked: { id: string; label: string }[];
  onPick: (booking: AttachableBooking) => void;
  onDrop: (bookingId: string) => void;
  /**
   * A reservation that cannot be taken off (SPC-31).
   *
   * Publishing an event *from* a booking makes that booking the thing the
   * event is made out of — it is what calls the event off if it is cancelled
   * — so the server attaches it either way. Offering an × that does nothing
   * would be worse than offering none.
   */
  fixedId?: string;
}) {
  const token = useAuthStore((s) => s.token);
  const [options, setOptions] = useState<AttachableBooking[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let live = true;

    api.events
      .attachableRooms(orgId, token, eventId ? { eventId } : {})
      .then((rows) => live && setOptions(rows))
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not read your bookings');
      });

    return () => {
      live = false;
    };
  }, [orgId, eventId, token]);

  const chosen = new Set(picked.map((p) => p.id));
  const offered = (options ?? []).filter((b) => !chosen.has(b.id));

  const when = (b: AttachableBooking) => {
    const start = new Date(b.startTime);
    const end = new Date(b.endTime);
    return `${start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <div>
      {picked.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {picked.map((p) => (
            <li
              key={p.id}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 py-1 pl-3 pr-2 text-sm"
            >
              <DoorOpen className="h-3.5 w-3.5 text-gray-400" />
              {p.label}
              {p.id === fixedId ? (
                <span className="text-xs text-gray-400">held for this</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Remove ${p.label}`}
                  onClick={() => onDrop(p.id)}
                  className="text-gray-400 hover:text-red-700"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {options === null && !error && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking for your room bookings…
        </p>
      )}

      {options !== null && offered.length === 0 && (
        <p className="text-sm text-gray-500">
          {picked.length > 0
            ? 'No other reservations of yours near this date.'
            : // The useful next step, not a dead end: they have to book it.
              'You have no room bookings near this date. Book the room first and it will appear here.'}
        </p>
      )}

      {offered.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
          {offered.map((booking) => (
            <li key={booking.id}>
              <button
                type="button"
                onClick={() => onPick(booking)}
                className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{booking.room.name}</span>
                  <span className="block text-xs text-gray-500">
                    {when(booking)}
                    {booking.status === 'PENDING' && ' · awaiting approval'}
                    {/* Whose it is, because a co-host's reservation appearing
                        in your list is only obvious if it says so. */}
                    {booking.user.name && ` · ${booking.user.name}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
