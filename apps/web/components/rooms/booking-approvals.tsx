'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import { api, type PendingBooking } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { approvalSummary, whenLabel } from '@/lib/booking-approvals';

/**
 * Room requests waiting on an organiser (SPC-32).
 *
 * Charley: "where do I see a room reservation request for a room that needs an
 * admin approval?" Nowhere. Approve and reject have worked since SpaceOS was
 * built, and nothing in the product ever called them — so a room with
 * `requiresApproval` collected requests that only existed in the database.
 * MaybeItsFate had three, one of them a launch party booked that morning, with
 * the gallery held for it.
 *
 * At the top of the rooms page rather than behind a tab, because an
 * approval queue is only useful if it is in the way.
 */
export function BookingApprovals({ orgId }: { orgId: string }) {
  const token = useAuthStore((s) => s.token);
  const [pending, setPending] = useState<PendingBooking[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setPending(await api.rooms.pendingBookings(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the requests');
    }
  }, [orgId, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(booking: PendingBooking, approve: boolean) {
    if (!token || busyId) return;
    setBusyId(booking.id);
    setError('');
    try {
      if (approve) await api.rooms.approveBooking(orgId, booking.id, token);
      else await api.rooms.rejectBooking(orgId, booking.id, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved');
    } finally {
      setBusyId(null);
    }
  }

  // Nothing waiting is the normal state, and a panel saying so every day is
  // furniture. It appears when there is something to do.
  if (!pending || pending.length === 0) return null;

  return (
    <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-amber-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-amber-900">{approvalSummary(pending)}</h2>
      </div>
      <p className="mt-1 text-sm text-amber-900">
        These rooms are held until you decide, and the member has been told it is waiting on
        you.
      </p>

      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {pending.map((booking) => (
          <li
            key={booking.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {booking.title}
                {/*
                  Shown rather than hidden (SPC-32). A request for last Tuesday
                  that nobody answered is not clutter — it is a member who was
                  left waiting, and dropping it would hide the evidence of the
                  very failure this panel exists to end.
                */}
                {booking.lapsed && (
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                    already passed
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-gray-600">
                {booking.room.name} &middot; {whenLabel(booking)} &middot;{' '}
                {booking.user.name ?? 'A member'}
                {booking.expectedAttendance ? ` · about ${booking.expectedAttendance} people` : ''}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => decide(booking, true)}
                disabled={busyId !== null}
                className="btn-primary inline-flex items-center gap-1 text-xs"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {busyId === booking.id ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => decide(booking, false)}
                disabled={busyId !== null}
                className="btn-secondary inline-flex items-center gap-1 text-xs"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
