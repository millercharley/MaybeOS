'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Search, UserPlus, Users } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, DoorList, Event } from '@/lib/api';

/**
 * The door list (IMP-10).
 *
 * Attendance was structurally zero across MaybeOS: the check-in API has
 * existed since EventOS was built and nothing has ever called it, so the
 * `attendance` table held no rows and every reach figure in the impact
 * dashboard could only report nothing. This is the screen that writes them.
 *
 * Built for standing at a door with one hand free. Big tap targets, a running
 * count in the header, search that filters as you type, and no confirmation
 * step — a wrong tap is undone by tapping again.
 */
export default function EventDoorListPage(props: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(props.params);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [list, setList] = useState<DoorList | null>(null);
  // The page never said which event you were checking people into — the
  // heading was "Check-in" and the breadcrumb was a raw UUID.
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [attendees, detail] = await Promise.all([
        api.events.attendees(orgId, eventId, token),
        api.events.get(orgId, eventId, token),
      ]);
      setList(attendees);
      setEvent(detail);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the door list');
    } finally {
      setLoading(false);
    }
  }, [token, orgId, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(rsvpId: string, checkedIn: boolean) {
    if (!token || !orgId) return;
    setPending(rsvpId);

    // Move the row immediately; a door queue does not wait for a round trip.
    setList((prev) =>
      prev
        ? {
            ...prev,
            expected: prev.expected.map((a) =>
              a.rsvpId === rsvpId ? { ...a, checkedIn: !checkedIn } : a,
            ),
            attendanceCount: prev.attendanceCount + (checkedIn ? -1 : 1),
          }
        : prev,
    );

    try {
      if (checkedIn) {
        await api.events.undoCheckIn(orgId, eventId, rsvpId, token);
      } else {
        await api.events.checkIn(orgId, eventId, rsvpId, token);
      }
      // Reconcile with the server, so the count on screen is the count that
      // will appear in the report rather than an optimistic guess.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
      await load();
    } finally {
      setPending(null);
    }
  }

  async function addWalkIn(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !orgId) return;
    setPending('walk-in');
    try {
      await api.events.recordWalkIn(orgId, eventId, walkInName.trim(), token);
      setWalkInName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that');
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        {error || 'Could not load the door list'}
      </div>
    );
  }

  const filtered = search
    ? list.expected.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()),
      )
    : list.expected;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All events
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {event?.title ?? 'Check-in'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tap a name as each person arrives. Tap again to undo.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {event?.host ? (
              <>Hosted by {event.host.name ?? 'a member'}</>
            ) : (
              // Every event made before EVT-04 has no host, and the PRD's
              // post-event follow-up needs one. Saying so beats an empty line.
              <span className="text-gray-400">No host set</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900">
            {list.attendanceCount}
            <span className="text-lg font-normal text-gray-400">
              {' '}
              / {list.expectedCount}
            </span>
          </p>
          <p className="text-xs text-gray-500">here / expected</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Find a name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-full pl-10"
        />
      </div>

      {list.expected.length === 0 ? (
        <div className="card py-12 text-center">
          <Users className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Nobody has RSVPed yet. You can still record people as they arrive.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.rsvpId}>
              <button
                type="button"
                onClick={() => toggle(a.rsvpId, a.checkedIn)}
                disabled={pending === a.rsvpId}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
                  a.checkedIn
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-white hover:border-brand-300'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    a.checkedIn ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {a.checkedIn ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-medium">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {a.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {a.isGuest && <span>Guest</span>}
                    {a.status === 'WAITLISTED' && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                        Waitlist
                      </span>
                    )}
                    {a.plusOnes > 0 && (
                      <span>
                        +{a.plusOnes} guest{a.plusOnes > 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                </span>

                <span
                  className={`shrink-0 text-xs font-semibold ${
                    a.checkedIn ? 'text-green-700' : 'text-gray-400'
                  }`}
                >
                  {a.checkedIn ? 'Here' : 'Tap'}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-gray-500">
              Nobody on the list matches &ldquo;{search}&rdquo;. If they turned up
              without RSVPing, add them below.
            </li>
          )}
        </ul>
      )}

      <section className="card">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <UserPlus className="h-4 w-4" />
          Someone who didn&apos;t RSVP
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          A name helps, but it isn&apos;t required — recording that one more person
          came is the point.
        </p>
        <form onSubmit={addWalkIn} className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={walkInName}
            onChange={(e) => setWalkInName(e.target.value)}
            maxLength={120}
            placeholder="Name (optional)"
            className="input min-w-0 flex-1"
          />
          <button
            type="submit"
            className="btn-secondary whitespace-nowrap"
            disabled={pending === 'walk-in'}
          >
            {pending === 'walk-in' ? 'Adding...' : 'Add'}
          </button>
        </form>

        {list.walkIns.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-gray-100 pt-3">
            {list.walkIns.map((w) => (
              <li key={w.attendanceId} className="text-sm text-gray-600">
                {w.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
