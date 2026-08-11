'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, CheckCircle2, Users, DoorOpen } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, Room, CreateRoomData, ApiError } from '@/lib/api';

type Draft = {
  name: string;
  description: string;
  capacity: string;
  amenities: string;
  requiresApproval: boolean;
  memberOnly: boolean;
  hourlyRate: string;
};

const emptyDraft: Draft = {
  name: '',
  description: '',
  capacity: '',
  amenities: '',
  requiresApproval: false,
  memberOnly: true,
  hourlyRate: '',
};

const draftFrom = (r: Room): Draft => ({
  name: r.name,
  description: r.description ?? '',
  capacity: r.capacity ? String(r.capacity) : '',
  amenities: (r.amenities ?? []).join('\n'),
  requiresApproval: r.requiresApproval,
  memberOnly: r.memberOnly,
  hourlyRate: r.hourlyRate ? (r.hourlyRate / 100).toFixed(2).replace(/\.00$/, '') : '',
});

const toPayload = (d: Draft): CreateRoomData => ({
  name: d.name.trim(),
  description: d.description.trim() || undefined,
  capacity: d.capacity ? parseInt(d.capacity, 10) : undefined,
  amenities: d.amenities.split('\n').map((a) => a.trim()).filter(Boolean),
  requiresApproval: d.requiresApproval,
  memberOnly: d.memberOnly,
  hourlyRate: d.hourlyRate ? Math.round(parseFloat(d.hourlyRate) * 100) : undefined,
});

export default function AdminRoomsPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

            <label className="block">
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
              <p className="mt-1 text-xs text-[var(--warning)]">
                Recorded but not charged — booking payments aren&apos;t built yet (SPC-06). Leave
                blank for free rooms.
              </p>
            </label>

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

              <button onClick={() => startEdit(r)} disabled={busy} className="btn-secondary">
                Edit
              </button>
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
