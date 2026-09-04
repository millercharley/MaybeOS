'use client';

import { useParams } from 'next/navigation';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, CheckCircle2, DoorOpen, CalendarClock, Megaphone, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, Booking, ApiError } from '@/lib/api';
import { EventForm, EventFormValues } from '@/components/events/event-form';
import { TouchpointAsk } from '@/components/impact/touchpoint-ask';
import { PageHeader } from '@/components/layout/page-header';

/**
 * Times are shown in the reader's own timezone, unlike the booking emails,
 * which still send raw UTC (SPC-08). Doing it correctly here at least means
 * the app itself isn't lying about when a room is booked.
 */
const fmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function when(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const endTime = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(end);
  return `${fmt.format(start)} – ${endTime}`;
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in *local* time, not an ISO string. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Awaiting approval', tone: 'badge-warning' },
  APPROVED: { label: 'Confirmed', tone: 'badge-success' },
  REJECTED: { label: 'Not confirmed', tone: 'badge-danger' },
  CANCELED: { label: 'Canceled', tone: 'badge-neutral' },
};

export default function MemberBookingsPage() {
  const orgSlug = useParams()?.orgSlug as string;
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [movingId, setMovingId] = useState<string | null>(null);
  // Publishing a booking as an event (EVT-05). The member already said when
  // and where by booking the room; this asks only what the co-op needs to
  // know about it.
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [published, setPublished] = useState<Record<string, string>>({});
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setBookings(await api.rooms.myBookings(orgId, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your bookings.');
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function publishAsEvent(bookingId: string, values: EventFormValues) {
    if (!token || !orgId) return;
    setBusyId(bookingId);
    setError(null);
    try {
      const event = await api.events.publishFromBooking(
        orgId,
        bookingId,
        {
          title: values.title,
          description: values.description,
          visibility: values.visibility,
          capacity: values.capacity,
          category: values.category,
          publish: values.publish,
        },
        token,
      );
      setPublishingId(null);
      setPublished((prev) => ({ ...prev, [bookingId]: event.id }));
      setNotice(
        values.publish
          ? 'Your event is live. It will be called off automatically if you cancel this booking.'
          : 'Saved as a draft. Publish it from My Events when you are ready.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not publish that.');
    } finally {
      setBusyId(null);
    }
  }

  function startMove(b: Booking) {
    setMovingId(b.id);
    setNewStart(toLocalInput(b.startTime));
    setNewEnd(toLocalInput(b.endTime));
    setNotice(null);
    setError(null);
  }

  async function submitMove(b: Booking) {
    if (!token || !orgId) return;
    setBusyId(b.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.rooms.reschedule(
        orgId,
        b.id,
        {
          // datetime-local gives local wall time; the API wants UTC.
          startTime: new Date(newStart).toISOString(),
          endTime: new Date(newEnd).toISOString(),
        },
        token,
      );
      setNotice(
        res.status === 'PENDING'
          ? 'Moved. Because the time changed, an organizer needs to confirm it again.'
          : 'Booking moved.',
      );
      setMovingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move that booking.');
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(b: Booking) {
    if (!token || !orgId) return;
    setBusyId(b.id);
    setError(null);
    setNotice(null);
    try {
      await api.rooms.cancelBooking(orgId, b.id, token);
      setNotice('Booking canceled. The room is free for someone else.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel that booking.');
    } finally {
      setBusyId(null);
    }
  }

  if (!orgId) {
    return <p className="text-[var(--text-secondary)]">No organization selected.</p>;
  }

  const live = (bookings ?? []).filter((b) => b.status === 'PENDING' || b.status === 'APPROVED');
  const past = (bookings ?? []).filter((b) => b.status !== 'PENDING' && b.status !== 'APPROVED');

  return (
    <div>
      <PageHeader
        title="My bookings"
        description="Rooms you&apos;ve booked, and anything still waiting on an organizer."
      />

      {orgId && <TouchpointAsk orgId={orgId} touchpoint="BOOKING" />}

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

      {bookings === null && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      )}

      {bookings?.length === 0 && (
        <p className="mt-8 text-[var(--text-secondary)]">
          You haven&apos;t booked anything yet.
        </p>
      )}

      <div className="mt-6 grid gap-3">
        {live.map((b) => {
          const s = STATUS[b.status] ?? STATUS.PENDING;
          const busy = busyId === b.id;
          return (
            <div key={b.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{b.title}</h3>
                    <span className={s.tone}>{s.label}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1">
                      <DoorOpen size={14} aria-hidden="true" />
                      {b.room?.name ?? 'Room'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock size={14} aria-hidden="true" />
                      {when(b.startTime, b.endTime)}
                    </span>
                  </p>
                </div>

                {movingId !== b.id && publishingId !== b.id && (
                  <div className="flex flex-wrap gap-2">
                    {/* Only a confirmed booking can be published — the API
                        refuses otherwise, and offering a button that always
                        fails would be worse than not offering one. */}
                    {b.status === 'APPROVED' && !published[b.id] && (
                      <button
                        onClick={() => setPublishingId(b.id)}
                        disabled={busy}
                        className="btn-secondary inline-flex items-center gap-1.5"
                      >
                        <Megaphone size={14} aria-hidden="true" />
                        Publish as event
                      </button>
                    )}
                    {published[b.id] && (
                      <Link href={`/member/${orgSlug}/events`} className="btn-ghost text-sm">
                        View event
                      </Link>
                    )}
                    <button onClick={() => startMove(b)} disabled={busy} className="btn-secondary">
                      Reschedule
                    </button>
                    <button onClick={() => cancel(b)} disabled={busy} className="btn-ghost">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
                    </button>
                  </div>
                )}
              </div>

              {movingId === b.id && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="text-sm font-medium">Move this booking</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <label className="text-sm">
                      <span className="block text-[var(--text-secondary)]">From</span>
                      <input
                        type="datetime-local"
                        className="input mt-1"
                        value={newStart}
                        onChange={(e) => setNewStart(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-[var(--text-secondary)]">To</span>
                      <input
                        type="datetime-local"
                        className="input mt-1"
                        value={newEnd}
                        onChange={(e) => setNewEnd(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => submitMove(b)}
                      disabled={busy || !newStart || !newEnd}
                      className="btn-primary inline-flex items-center gap-2"
                    >
                      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      Move booking
                    </button>
                    <button onClick={() => setMovingId(null)} disabled={busy} className="btn-secondary">
                      Keep as is
                    </button>
                  </div>
                </div>
              )}

              {publishingId === b.id && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Tell people about it</p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {b.room?.name ?? 'The room'} on {when(b.startTime, b.endTime)} — taken
                        from this booking, so the two cannot disagree. Cancel the booking and
                        the event is called off with it.
                      </p>
                    </div>
                    <button
                      onClick={() => setPublishingId(null)}
                      className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      aria-label="Close"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <EventForm
                    initial={{ title: b.title, startTime: b.startTime, endTime: b.endTime }}
                    submitLabel="Publish event"
                    busy={busy}
                    onSubmit={(values) => publishAsEvent(b.id, values)}
                    onCancel={() => setPublishingId(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {past.length > 0 && (
        <>
          <h2 className="mt-10 font-display text-lg">Past &amp; canceled</h2>
          <div className="mt-3 grid gap-2">
            {past.map((b) => {
              const s = STATUS[b.status] ?? STATUS.CANCELED;
              return (
                <div key={b.id} className="card opacity-70">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="font-medium">{b.title}</span>
                      <span className="ml-2 text-sm text-[var(--text-secondary)]">
                        {b.room?.name} · {when(b.startTime, b.endTime)}
                      </span>
                    </div>
                    <span className={s.tone}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
