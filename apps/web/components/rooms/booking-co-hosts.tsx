'use client';

import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { api, ApiError, type Booking } from '@/lib/api';
import { MemberPicker } from '@/components/member/member-picker';

/**
 * Who else may manage this room reservation (SPC-37).
 *
 * Charley: "As a member, I want to add a co-host to a room reservation."
 *
 * Shown on every row of My Bookings, because the most useful thing it says
 * needs no interaction: whether somebody else is on this, and who. A
 * reservation two people run looked exactly like one person's.
 *
 * **Only the owner is offered the controls.** A co-host can move the
 * reservation and cancel it; they cannot decide who else is on it, which is
 * the line events draw too — the person who asked for help stays the person
 * who can un-ask. For a co-host this is a sentence saying whose it is.
 */
export function BookingCoHosts({
  orgId,
  token,
  booking,
  viewerId,
  onChange,
}: {
  orgId: string;
  token: string;
  booking: Booking;
  /** Who is looking, which decides whether this is a control or a label. */
  viewerId?: string;
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coHosts = booking.coHosts ?? [];
  const mine = !viewerId || !booking.user ? true : booking.user.id === viewerId;

  async function add(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.rooms.addCoHost(orgId, booking.id, userId, token);
      setAdding(false);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add them.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.rooms.removeCoHost(orgId, booking.id, userId, token);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not take them off.');
    } finally {
      setBusy(false);
    }
  }

  /*
    A reservation somebody added this member to.

    They get the fact and not the controls. Saying whose it is matters more
    here than anywhere else: it is in their My Bookings, and without this
    sentence a reservation they cannot share looks like one of their own that
    is quietly broken.
  */
  if (!mine) {
    return (
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {booking.user?.name ?? 'Another member'} booked this and added you, so you can move
        or cancel it.
      </p>
    );
  }

  return (
    <div className="mt-2">
      {error && <p className="mb-1 text-sm text-[var(--danger)]">{error}</p>}

      {coHosts.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {coHosts.map((co) => (
            <li
              key={co.userId}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] py-1 pl-3 pr-2 text-sm"
            >
              {co.user.name ?? 'Member'}
              <button
                type="button"
                aria-label={`Take ${co.user.name ?? 'them'} off this reservation`}
                onClick={() => remove(co.userId)}
                disabled={busy}
                className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div>
          <MemberPicker
            orgId={orgId}
            placeholder="Search for a member…"
            // Never the owner, never somebody already on it.
            exclude={[...(booking.user ? [booking.user.id] : []), ...coHosts.map((c) => c.userId)]}
            busy={busy}
            onPick={(member) => add(member.user.id)}
          />
          <button type="button" onClick={() => setAdding(false)} className="btn-ghost mt-1 text-sm">
            Never mind
          </button>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            They will see this reservation in their own My Bookings and can move or cancel
            it. They cannot add anybody else.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus size={14} aria-hidden="true" />
          )}
          {coHosts.length > 0 ? 'Add someone else' : 'Add a co-host'}
        </button>
      )}
    </div>
  );
}
