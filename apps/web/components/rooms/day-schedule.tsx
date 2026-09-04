'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lock, Loader2, Users } from 'lucide-react';
import { api, type DaySchedule as DayScheduleData } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * What is on across the whole building today (SPC-18).
 *
 * Charley: a view of the entire day for all the room reservations, with the
 * host, the title and the description, for any member. A co-op sharing a
 * building has one obvious question every morning — what is happening and who
 * is in which room — and answering it meant opening each room's calendar in
 * turn.
 *
 * Grouped by room rather than laid out as a timetable grid. A grid is the
 * prettier answer and the wrong one here: it needs a fixed pixel-per-minute
 * scale to be readable, which on a phone is either unreadably narrow or a
 * sideways scroll, and a co-op with three rooms and five bookings does not
 * have a scheduling problem that a grid solves. Rooms with nothing on are
 * listed too, because "the studio is free all day" is half of what somebody
 * came here to find out.
 */
export function DaySchedule({ orgId, initialDate }: { orgId: string; initialDate: string }) {
  const token = useAuthStore((s) => s.token);

  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<DayScheduleData | null>(null);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [day, roomList] = await Promise.all([
        api.rooms.day(orgId, date, token),
        api.rooms.list(orgId, token),
      ]);
      setData(day);
      setRooms(roomList.map((r) => ({ id: r.id, name: r.name })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the day');
    } finally {
      setLoading(false);
    }
  }, [orgId, token, date]);

  useEffect(() => {
    load();
  }, [load]);

  // Shifted as a plain calendar date, never by adding 24 hours to an instant:
  // a day either side of a clock change is 23 or 25 hours long, and the
  // arrows would skip or repeat a day once a year.
  function shiftDay(iso: string, by: number) {
    const [y, m, d] = iso.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d));
    at.setUTCDate(at.getUTCDate() + by);
    return at.toISOString().slice(0, 10);
  }

  const zone = data?.timezone;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    });

  const heading = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const byRoom = rooms.map((room) => ({
    room,
    bookings: (data?.bookings ?? []).filter((b) => b.room.id === room.id),
  }));

  return (
    <section className="card">
      {/* One line, always — the same shape the month arrows now use. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDate(shiftDay(date, -1))}
          className="btn-ghost shrink-0"
          aria-label="Previous day"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <h2
          className="min-w-0 flex-1 text-center text-lg font-semibold"
          aria-live="polite"
        >
          {heading}
        </h2>
        <button
          type="button"
          onClick={() => setDate(shiftDay(date, 1))}
          className="btn-ghost shrink-0"
          aria-label="Next day"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      {date !== initialDate && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => setDate(initialDate)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Back to today
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : byRoom.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          This co-op has no rooms yet.
        </p>
      ) : (
        <ul className="mt-5 space-y-5">
          {byRoom.map(({ room, bookings }) => (
            <li key={room.id}>
              <h3 className="text-sm font-semibold text-gray-900">{room.name}</h3>

              {bookings.length === 0 ? (
                /* Worth saying out loud: "free all day" is half of what
                   somebody opened this view to find out. */
                <p className="mt-1 text-sm text-gray-400">Free all day.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {bookings.map((b) => (
                    <li
                      key={b.id}
                      className="rounded-xl border border-gray-200 p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="data text-sm font-medium text-gray-900">
                          {time(b.startTime)} – {time(b.endTime)}
                        </span>
                        {b.status === 'PENDING' && (
                          <span className="badge-warning">Awaiting approval</span>
                        )}
                      </div>

                      <p className="mt-1 text-sm font-semibold text-gray-900">{b.title}</p>

                      <p className="mt-0.5 text-sm text-gray-500">
                        {b.user.name || 'A member'}
                        {typeof b.expectedAttendance === 'number' && b.expectedAttendance > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-400">
                            <Users className="h-3 w-3" />
                            {b.expectedAttendance}
                          </span>
                        )}
                      </p>

                      {b.description && (
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-600">
                          {b.description}
                        </p>
                      )}

                      {/* Said, rather than left as a gap. A member who sees
                          nothing under a title cannot tell whether the host
                          wrote nothing or whether something is being kept
                          from them. */}
                      {b.descriptionWithheld && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <Lock className="h-3 w-3" />
                          Details are private to this booking&rsquo;s guests.
                        </p>
                      )}

                      {b.categories.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {b.categories.map((c) => (
                            <span
                              key={c}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 flex items-center gap-1.5 border-t border-gray-100 pt-3 text-xs text-gray-400">
        <CalendarDays className="h-3.5 w-3.5" />
        Times are the co-op&rsquo;s own, wherever you are reading this.
      </p>
    </section>
  );
}
