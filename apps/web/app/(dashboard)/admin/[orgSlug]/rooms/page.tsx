'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, CheckCircle2, Users, DoorOpen } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api, Room, CreateRoomData, ApiError } from '@/lib/api';
import { RoomCalendar } from '@/components/rooms/room-calendar';
import { calendarNotice } from '@/lib/room-calendar';

type Draft = {
  name: string;
  description: string;
  capacity: string;
  amenities: string;
  requiresApproval: boolean;
  memberOnly: boolean;
  alwaysAvailable: boolean;
  chargeForBooking: boolean;
  hourlyRate: string;
};

const emptyDraft: Draft = {
  name: '',
  description: '',
  capacity: '',
  amenities: '',
  requiresApproval: false,
  memberOnly: true,
  alwaysAvailable: false,
  chargeForBooking: false,
  hourlyRate: '',
};

const draftFrom = (r: Room): Draft => ({
  name: r.name,
  description: r.description ?? '',
  capacity: r.capacity ? String(r.capacity) : '',
  amenities: (r.amenities ?? []).join('\n'),
  requiresApproval: r.requiresApproval,
  memberOnly: r.memberOnly,
  alwaysAvailable: r.alwaysAvailable ?? false,
  chargeForBooking: r.chargeForBooking ?? false,
  hourlyRate: r.hourlyRate ? (r.hourlyRate / 100).toFixed(2).replace(/\.00$/, '') : '',
});

const toPayload = (d: Draft): CreateRoomData => ({
  name: d.name.trim(),
  description: d.description.trim() || undefined,
  capacity: d.capacity ? parseInt(d.capacity, 10) : undefined,
  amenities: d.amenities.split('\n').map((a) => a.trim()).filter(Boolean),
  requiresApproval: d.requiresApproval,
  memberOnly: d.memberOnly,
  alwaysAvailable: d.alwaysAvailable,
  // Never sent as true without a rate: charging is two deliberate steps, and
  // a switch on its own would take a member to a checkout for $0.00.
  chargeForBooking: d.chargeForBooking && Boolean(d.hourlyRate),
  hourlyRate: d.hourlyRate ? Math.round(parseFloat(d.hourlyRate) * 100) : undefined,
});

export default function AdminRoomsPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;
  // Charging needs a connected account, exactly as ticket sales do (EVT-06).
  const { data: org } = useApi((t, o) => api.orgs.get(o, t), []);
  const canCharge = Boolean(org?.stripeChargesEnabled);

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState('');

  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setRooms(await api.rooms.list(orgId, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * What Google's redirect is telling us.
   *
   * Without this the admin returns from consent to a page that looks exactly
   * as it did before they left — the room list re-renders with a calendar now
   * attached and nothing marks the moment. "Connected" is also not "finished":
   * a calendar still has to be chosen, so the message says so.
   */
  useEffect(() => {
    // Read from `window.location` rather than `useSearchParams`, matching the
    // reports page: one query string is not worth a Suspense boundary.
    const result = new URLSearchParams(window.location.search).get('calendar');
    if (!result) return;

    // Cleared from the URL so a refresh does not replay the message.
    window.history.replaceState({}, '', window.location.pathname);

    const said = calendarNotice(result);
    if (!said) return;

    if (said.kind === 'error') setCalendarError(said.message);
    else setNotice(said.message);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCreate() {
    setDraft(emptyDraft);
    setEditingId(null);
    setCreating(true);
    setNotice(null);
    setError(null);
  }

  function startEdit(r: Room) {
    setDraft(draftFrom(r));
    setEditingId(r.id);
    setCreating(false);
    setNotice(null);
    setError(null);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save() {
    if (!token || !orgId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (creating) {
        await api.rooms.create(orgId, toPayload(draft), token);
        setNotice(`"${draft.name}" is now bookable.`);
      } else if (editingId) {
        await api.rooms.update(orgId, editingId, toPayload(draft), token);
        setNotice(`"${draft.name}" updated.`);
      }
      cancel();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the room.');
    } finally {
      setBusy(false);
    }
  }

  if (!orgId) {
    return <p className="text-[var(--text-secondary)]">No organization selected.</p>;
  }

  const showForm = creating || !!editingId;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl leading-tight">Rooms &amp; spaces</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            What members can book, and on what terms.
          </p>
        </div>
        {!showForm && (
          <button onClick={startCreate} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} aria-hidden="true" />
            Add room
          </button>
        )}
      </div>

      {notice && (
        <div className="card mt-6 flex gap-3 border-[var(--success)]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]" />
          <p className="text-sm">{notice}</p>
        </div>
      )}
      {error && (
        <div className="card mt-6 flex gap-3 border-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger)]" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {showForm && (
        <div className="card mt-6">
          <h2 className="font-display text-lg">
            {creating ? 'Add a room' : `Edit ${rooms?.find((r) => r.id === editingId)?.name ?? ''}`}
          </h2>

          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                className="input mt-1 w-full"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Main Hall"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Description</span>
              <input
                className="input mt-1 w-full"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Large room with a stage and PA"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Capacity</span>
              <input
                type="number"
                min="1"
                step="1"
                className="input mt-1 w-32"
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                placeholder="40"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Amenities</span>
              <textarea
                className="input mt-1 w-full"
                rows={3}
                value={draft.amenities}
                onChange={(e) => setDraft({ ...draft, amenities: e.target.value })}
                placeholder={'One per line\nProjector\nKitchen access\nStep-free entry'}
              />
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.requiresApproval}
                onChange={(e) => setDraft({ ...draft, requiresApproval: e.target.checked })}
              />
              <span className="text-sm">
                <span className="font-medium">Requires approval</span>
                <br />
                <span className="text-[var(--text-secondary)]">
                  Bookings wait for an admin instead of confirming immediately.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.memberOnly}
                onChange={(e) => setDraft({ ...draft, memberOnly: e.target.checked })}
              />
              <span className="text-sm">
                <span className="font-medium">Members only</span>
                <br />
                <span className="text-[var(--text-secondary)]">
                  Hidden from people who aren&apos;t members.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.alwaysAvailable}
                onChange={(e) => setDraft({ ...draft, alwaysAvailable: e.target.checked })}
              />
              <span className="text-sm">
                <span className="font-medium">Always available</span>
                <br />
                <span className="text-[var(--text-secondary)]">
                  Bookable at any hour, with no opening times to set. Leave this off and the
                  room stays unbookable until you give it availability rules — a room with
                  neither used to be quietly open at 3am.
                </span>
              </span>
            </label>

            {/* Booking emails are not a setting; they already happen. Saying so
                here because an organiser has no other way to know, and "does
                this email anyone?" is the first question about a booking. */}
            <p className="text-sm text-[var(--text-secondary)]">
              Members are emailed automatically at every step of a booking — requested,
              confirmed, rejected, moved and cancelled.
            </p>

            {/*
              Charging is off unless an admin turns it on AND sets a rate
              (SPC-06). Two steps rather than "a rate means charge", so that
              typing a number to note what a room is worth cannot start
              billing members.
            */}
            <fieldset className="rounded-lg border border-[var(--border)] p-3">
              <legend className="px-1 text-sm font-medium">Charging for hire</legend>

              <label className="flex items-start gap-2.5">
                <input
                  id="room-charge"
                  type="checkbox"
                  checked={draft.chargeForBooking}
                  disabled={!canCharge}
                  onChange={(e) => setDraft({ ...draft, chargeForBooking: e.target.checked })}
                  className="mt-0.5 h-4 w-4 disabled:opacity-40"
                />
                <span className="text-sm">
                  <span className={canCharge ? '' : 'text-[var(--text-tertiary)]'}>
                    Charge members to book this room
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
                    {canCharge
                      ? 'Off by default. Members pay when they book, and are refunded automatically if the booking is rejected or cancelled.'
                      : 'Finish setting up payments in Settings → Ticket sales before you can charge for rooms.'}
                  </span>
                </span>
              </label>

              <label className="mt-3 block">
                <span className="text-sm font-medium">Hourly rate</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)]">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input w-32"
                    value={draft.hourlyRate}
                    onChange={(e) => setDraft({ ...draft, hourlyRate: e.target.value })}
                    placeholder="0.00"
                  />
                  <span className="text-sm text-[var(--text-tertiary)]">per hour</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  {draft.chargeForBooking && draft.hourlyRate
                    ? `A three-hour booking costs $${(parseFloat(draft.hourlyRate || '0') * 3).toFixed(2)}, plus MaybeOS's flat per-booking fee. You receive the full rate.`
                    : 'Part-hours are billed pro rata. Nothing is charged until you switch charging on.'}
                </p>
              </label>
            </fieldset>

            <div className="flex gap-3">
              <button
                onClick={save}
                disabled={busy || !draft.name.trim()}
                className="btn-primary inline-flex items-center gap-2"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {creating ? 'Add room' : 'Save changes'}
              </button>
              <button onClick={cancel} disabled={busy} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-3">
        {calendarError && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {calendarError}
          </p>
        )}

        {rooms === null && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        )}

        {rooms?.length === 0 && (
          <p className="text-[var(--text-secondary)]">
            No rooms yet. Add one so members have something to book.
          </p>
        )}

        {rooms?.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DoorOpen size={16} className="text-[var(--text-tertiary)]" aria-hidden="true" />
                  <h3 className="font-semibold">{r.name}</h3>
                  {r.requiresApproval && <span className="badge-warning">Needs approval</span>}
                  {!r.memberOnly && <span className="badge-info">Open to non-members</span>}
                </div>
                {r.description && (
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{r.description}</p>
                )}
                <p className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-tertiary)]">
                  {r.capacity ? (
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} aria-hidden="true" />
                      {r.capacity}
                    </span>
                  ) : null}
                  {r.amenities?.length ? <span>{r.amenities.join(' · ')}</span> : null}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
                {token && orgId && (
                  <RoomCalendar room={r} orgId={orgId} token={token} onChange={load} />
                )}
                <button onClick={() => startEdit(r)} disabled={busy} className="btn-secondary">
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/*
        The previous version of this page promised a "Pending bookings" section and told admins to
        use a per-room "Manage" button — neither of which existed. Removed rather than left in
        place: a control that does nothing is worse than an absent one. Reviewing bookings is
        SPC-02/SPC-03 work.
      */}
      <p className="mt-8 text-xs text-[var(--text-tertiary)]">
        Rooms with no availability rules can be booked at any time. Opening hours, blackout dates,
        Google Calendar sync and booking emails are still to come.
      </p>
    </div>
  );
}
