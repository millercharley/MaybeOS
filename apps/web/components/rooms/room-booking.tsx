'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, DoorOpen, Loader2 } from 'lucide-react';
import { api, ApiError, type Room, type Slot, type SlotsResponse } from '@/lib/api';
import { BookingDetailsForm, type BookingDetails } from '@/components/rooms/booking-details';
import {
  dateLabel,
  durationLabel,
  localDate,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  timeLabel,
  zoneLabel,
} from '@/lib/booking-calendar';

/**
 * Booking a room by picking a time that is actually free (SPC-15).
 *
 * The old form took a start and an end and refused afterwards if the room was
 * shut, taken, or on somebody's calendar — which tells a member their choice
 * was wrong once they have made it, and nothing about which choice would have
 * worked. Every candidate time is shown here, with the taken ones crossed out
 * rather than hidden: a list that omits them looks like a quiet day rather
 * than a full one.
 *
 * Times are the co-op's wall clock, and the zone is named on the screen. A
 * member booking from another city otherwise has no way to tell the building's
 * hours from their own.
 */
export function RoomBooking({
  room,
  orgId,
  token,
  onBooked,
}: {
  room: Room;
  orgId: string;
  token: string;
  onBooked?: () => void;
}) {
  const [duration, setDuration] = useState(60);
  const [month, setMonth] = useState(() => monthOf(localDate(new Date(), 'UTC')));
  const [date, setDate] = useState<string | null>(null);

  const [data, setData] = useState<SlotsResponse | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  // Picking a slot opens the details step rather than booking outright. It
  // used to book immediately with the room's own name as the title, which is
  // why the calendar read "Attic" against every block (SPC-21).
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  const timeZone = data?.timeZone ?? 'UTC';
  const durations = data?.durations ?? [30, 60, 90, 120, 180];

  // The co-op's today, not the reader's. A member in Los Angeles opening this
  // at 10pm should not be shown tomorrow in New York.
  const today = useMemo(() => localDate(new Date(), timeZone), [timeZone]);

  // Fetched once per month and duration rather than per day: thirty round
  // trips to render one month would make the calendar slower than the booking.
  useEffect(() => {
    let live = true;

    api.availability
      .openDays(orgId, room.id, month, duration, token)
      .then((res) => live && setOpenDays(new Set(res.open)))
      .catch(() => live && setOpenDays(new Set()));

    return () => {
      live = false;
    };
  }, [orgId, room.id, month, duration, token]);

  const loadSlots = useCallback(
    async (forDate: string) => {
      setLoading(true);
      setError('');
      try {
        setData(await api.availability.slots(orgId, room.id, forDate, duration, token));
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not load times for that day.',
        );
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [orgId, room.id, duration, token],
  );

  useEffect(() => {
    if (date) loadSlots(date);
  }, [date, loadSlots]);

  async function book(slot: Slot, details: BookingDetails) {
    setBooking(slot.start);
    setError('');
    try {
      const created = await api.rooms.createBooking(
        orgId,
        room.id,
        { ...details, startTime: slot.start, endTime: slot.end },
        token,
      );

      // A room that charges returns a checkout and a booking that is only a
      // hold until it is paid for. Ignoring the URL leaves the member holding
      // a slot they were never given the chance to pay for, and it lapses in
      // thirty minutes.
      if (created.checkoutUrl) {
        window.location.assign(created.checkoutUrl);
        return;
      }

      setConfirmed(slot);
      setChosen(null);
      if (date) await loadSlots(date);
      onBooked?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not book that time.');
    } finally {
      setBooking(null);
    }
  }

  const cells = monthGrid(month);
  const slots = data?.slots ?? [];

  return (
    <div className="grid gap-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* ── The room, and which day ───────────────────────────── */}
      <div className="bg-[var(--surface-sunken)] p-6">
        <div className="text-center">
          {room.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={room.imageUrl}
              alt=""
              className="mx-auto h-24 w-24 rounded-full border-2 border-[var(--surface)] object-cover"
            />
          ) : (
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--surface)]">
              <DoorOpen size={28} aria-hidden="true" className="text-[var(--text-tertiary)]" />
            </div>
          )}

          <h2 className="mt-4 text-2xl font-semibold">{room.name}</h2>
          {room.description && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{room.description}</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="btn-ghost"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="text-lg font-semibold" aria-live="polite">
            {monthLabel(month)}
          </span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="btn-ghost"
            aria-label="Next month"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-[var(--text-tertiary)]">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell.date) return <span key={`pad-${i}`} />;

            const past = cell.date < today;
            const open = openDays.has(cell.date);
            const selected = cell.date === date;

            return (
              <button
                key={cell.date}
                onClick={() => setDate(cell.date)}
                // A day with nothing left is still worth opening — the slot
                // list says *why* it is full, which the calendar cannot.
                disabled={past}
                aria-pressed={selected}
                aria-label={dateLabel(cell.date)}
                className={[
                  'relative flex aspect-square items-center justify-center rounded-full text-sm transition-colors',
                  selected
                    ? 'bg-[var(--text-primary)] font-semibold text-[var(--surface)]'
                    : past
                      ? 'text-[var(--text-tertiary)] line-through'
                      : 'hover:bg-[var(--surface)]',
                ].join(' ')}
              >
                {cell.day}
                {open && !selected && !past && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--text-secondary)]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Duration, then the times ──────────────────────────── */}
      <div className="p-6">
        {chosen ? (
          <BookingDetailsForm
            roomName={room.name}
            when={`${dateLabel(chosen.start.slice(0, 10))} at ${timeLabel(chosen.minutes)}`}
            busy={booking !== null}
            onBack={() => setChosen(null)}
            onConfirm={(details) => book(chosen, details)}
          />
        ) : !date ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Pick a day. Days with a dot have time left.
          </p>
        ) : (
          <>
            <p className="rounded-lg bg-[var(--surface-sunken)] px-4 py-3 text-center font-semibold">
              {dateLabel(date)}
            </p>

            <h3 className="mt-6 font-semibold">Duration</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {durations.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  aria-pressed={d === duration}
                  className={[
                    'flex-1 whitespace-nowrap rounded-lg border px-4 py-2 text-sm transition-colors',
                    d === duration
                      ? 'border-[var(--text-primary)] bg-[var(--surface-sunken)] font-semibold'
                      : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]',
                  ].join(' ')}
                >
                  {durationLabel(d)}
                </button>
              ))}
            </div>
            {room.maxBookingMinutes ? (
              <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                This room can be booked for up to {durationLabel(room.maxBookingMinutes)} at a
                time.
              </p>
            ) : null}

            <h3 className="mt-6 font-semibold">Time</h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              {zoneLabel(timeZone, new Date())}
            </p>

            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Checking what is free…
              </p>
            ) : slots.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                This room has no bookable hours yet. An organiser needs to set its
                availability, or mark it as always available.
              </p>
            ) : (
              <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
                {slots.map((slot) => (
                  <li key={slot.start}>
                    <button
                      onClick={() => setChosen(slot)}
                      disabled={!slot.available || booking !== null}
                      title={slot.available ? undefined : reasonFor(slot)}
                      className={[
                        'w-full rounded-lg border px-4 py-3 text-center transition-colors',
                        slot.available
                          ? 'border-[var(--border)] hover:border-[var(--text-primary)] hover:bg-[var(--surface-sunken)]'
                          : 'cursor-not-allowed border-transparent bg-[var(--surface-sunken)] text-[var(--text-tertiary)] line-through',
                      ].join(' ')}
                    >
                      {booking === slot.start ? 'Booking…' : timeLabel(slot.minutes)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {confirmed && (
          <p className="mt-4 rounded-lg border border-[var(--success)] px-4 py-3 text-sm">
            Booked — {dateLabel(confirmed.start.slice(0, 10))} at{' '}
            {timeLabel(confirmed.minutes)}.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}

/**
 * Why a slot is crossed out.
 *
 * "Unavailable" is what the member can already see. Which of these it is
 * decides what they do next: wait for an answer, pick another day, or ask an
 * organiser why the room is shut.
 */
function reasonFor(slot: Slot): string {
  switch (slot.reason) {
    case 'past':
      return 'Already gone';
    case 'closed':
      return 'Outside this room’s hours';
    case 'blackout':
      // The reason when a closure gave one: "Closed: Winter break" tells a
      // member whether to come back tomorrow or in January (SPC-18).
      return slot.note ? `Closed: ${slot.note}` : 'The room is closed then';
    case 'booked':
      return 'Someone has booked this';
    case 'calendar':
      return 'Taken on the room’s calendar';
    default:
      return 'Not available';
  }
}
