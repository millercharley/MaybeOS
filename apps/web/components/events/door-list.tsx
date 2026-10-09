'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Search, UserPlus, Users } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { money } from '@/lib/fees';
// Aliased: the data shape and the component that renders it would
// otherwise share a name.
import { api, DoorList as DoorListData, Event, EventWaitlist, Org, TicketSale } from '@/lib/api';
import { MemberName } from '@/components/member/member-name';
import { EventOverview } from '@/components/events/event-overview';

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
/**
 * The door list for one event.
 *
 * Shared by the organiser's copy and the host's, because the host is who
 * actually stands at the door — Charley, 2026-08-19: "the host of the event is
 * responsible for checking in guests not the admin." Two copies of a screen
 * that must behave identically is two screens that eventually do not.
 *
 * `showTickets` used to be the one real difference, because who paid and
 * refunding them was ADMIN/STAFF only and a host fetching that list would be
 * refused — taking the door list down with it, since they load together.
 *
 * Whoever runs the event may now see and refund their own sales (EVT-41), so
 * the host's copy asks for it too. The API decides the same thing again: the
 * flag chooses what to draw, never who is allowed.
 */
export function DoorList({
  eventId,
  backHref,
  showTickets = false,
  overviewFor,
  hostsIfMine = false,
}: {
  eventId: string;
  backHref: string;
  showTickets?: boolean;
  /**
   * The co-op's slug, which turns this into an organiser's event page rather
   * than only a door (EVT-31): everything about the event, above the list.
   *
   * It renders from the event this screen already loads, so the overview
   * costs no extra request — and the host's name, the room and the ticket
   * total cannot drift from what the door is showing.
   */
  overviewFor?: string;
  /**
   * Offer the host controls when this reader is the host or the creator
   * (EVT-32) — the member's own copy, where an organiser's role guard does
   * not apply. The API checks it again either way.
   */
  hostsIfMine?: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const me = useAuthStore((s) => s.user?.id);
  const router = useRouter();

  const [list, setList] = useState<DoorListData | null>(null);
  // The page never said which event you were checking people into — the
  // heading was "Check-in" and the breadcrumb was a raw UUID.
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState('');
  // Who paid, and whether we have given it back. There was no way to ask this
  // at all: the refund endpoint took a ticket id nothing in the product could
  // produce, so an organiser could neither see a sale nor undo one.
  const [tickets, setTickets] = useState<TicketSale[]>([]);
  const [waitlist, setWaitlist] = useState<EventWaitlist | null>(null);
  const [waitlistError, setWaitlistError] = useState('');
  const [promoting, setPromoting] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundError, setRefundError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [attendees, detail, theOrg] = await Promise.all([
        api.events.attendees(orgId, eventId, token),
        api.events.get(orgId, eventId, token),
        /*
          Whether this co-op has connected Instagram and Facebook (SOC-02).

          Alongside the other two rather than after them, so it costs no
          extra round trip — but caught, because `Promise.all` rejects as a
          whole. This decides whether one button is drawn; it must not be
          able to take the door list down with it, which is the same reason
          the tickets below are fetched apart.
        */
        api.orgs.get(orgId, token).catch(() => null),
      ]);
      setList(attendees);
      setEvent(detail);
      setOrg(theOrg);

      /*
        Who bought a ticket, for whoever runs the event (EVT-33).

        This was organisers only, so a host could not see the door they were
        standing at. The API now answers for the host, the creator and a
        co-host too — and still refuses everybody else, so this is fetched
        separately: a 403 here must not take the door list down with it.
      */
      if (showTickets || hostsIfMine) {
        try {
          setTickets(await api.events.listTickets(orgId, eventId, token));
        } catch {
          // Not theirs to see. The rest of the page is.
          setTickets([]);
        }
      }
      /*
        Who is waiting (EVT-41). Separately and quietly, for the same reason
        as the tickets above: a reader who may see the door but not run the
        event gets a 403 here, and that must not take the door list down.
      */
      try {
        setWaitlist(await api.events.waitlist(orgId, eventId, token));
      } catch {
        setWaitlist(null);
      }

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the door list');
    } finally {
      setLoading(false);
    }
  }, [token, orgId, eventId, showTickets, hostsIfMine]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Give somebody on the waitlist a place (EVT-41).
   *
   * Confirmed, and the confirm names them: this emails that person to say
   * they are in, which is not a thing to do by brushing past a button.
   */
  async function promote(rsvpId: string, who: string) {
    if (!token || !orgId) return;
    if (!window.confirm(`Give ${who} a place? They will be emailed to say they are in.`)) return;

    setPromoting(rsvpId);
    setWaitlistError('');
    try {
      await api.events.promoteFromWaitlist(orgId, eventId, rsvpId, token);
      // Reloaded rather than patched: promoting moves somebody out of the
      // waitlist and into the door list, and both are on this screen.
      await load();
    } catch (err) {
      setWaitlistError(err instanceof Error ? err.message : 'Could not give them a place');
    } finally {
      setPromoting(null);
    }
  }

  async function refund(ticketId: string, who: string, amountCents: number) {
    if (!token || !orgId) return;
    // Money leaving the co-op's account on one click deserves a question, and
    // the confirm names the person and the amount rather than asking "are you
    // sure?" about nothing in particular.
    if (!window.confirm(`Refund ${money(amountCents)} to ${who}? This cannot be undone.`)) return;

    setRefunding(ticketId);
    setRefundError('');
    try {
      const result = await api.events.refundTicket(orgId, ticketId, token);
      if (!result.refunded) {
        // Stripe declining and the ticket already being refunded are different
        // news, and the API says which.
        setRefundError(result.reason ? `Not refunded: ${result.reason}` : 'Not refunded');
      }
      await load();
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : 'Could not refund that ticket');
    } finally {
      setRefunding(null);
    }
  }

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
          href={backHref}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          All events
        </Link>
      </div>

      {/* An organiser opens an event to find out about it; the door list is
          what they do once they are standing at it (EVT-31). */}
      {overviewFor && event && (
        <EventOverview
          event={event}
          orgSlug={overviewFor}
          orgId={orgId ?? undefined}
          tickets={showTickets || hostsIfMine ? tickets : undefined}
          // An organiser reaches this page through the admin console, which
          // is already behind a role guard; the API checks it again, and
          // refuses the host or creator nothing (EVT-32).
          canManageHosts={
            showTickets ||
            (hostsIfMine &&
              Boolean(
                me && (me === event.host?.id || me === event.createdById),
              ))
          }
          onChanged={load}
          /*
            The edit form lives on the Events page, which this screen does not
            host. Rather than making an organiser go back and find the card
            again, Edit opens that page with this event's form already open
            (EVT-35).
          */
          onEdit={() => router.push(`${backHref}?edit=${event.id}`)}
          sharingOn={Boolean(org?.socialSharingEnabled)}
          canRemove={showTickets}
          backHref={backHref}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {overviewFor ? 'Check-in' : (event?.title ?? 'Check-in')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tap a name as each person arrives. Tap again to undo.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {event?.host ? (
              <>Hosted by <MemberName userId={event.host.id} name={event.host.name ?? 'a member'} /></>
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
                    <MemberName userId={a.userId} name={a.name} />
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

      {(showTickets || hostsIfMine) && tickets.length > 0 && (
        <section className="card">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">Tickets</h2>
            <p className="text-sm text-gray-500">
              {tickets.filter((t) => !t.refundedAt).length} sold ·{' '}
              {money(
                tickets
                  .filter((t) => !t.refundedAt)
                  .reduce((sum, t) => sum + t.amountCents - t.platformFeeCents, 0),
              )}{' '}
              to your co-op
            </p>
          </div>
          {/* Said plainly before anyone presses the button, because it is the
              part that surprises people: Stripe keeps its processing fee on a
              refund, so giving money back costs the co-op money. */}
          <p className="mb-4 text-xs text-gray-500">
            Refunding returns the buyer everything, including the MaybeOS fee. Stripe keeps its
            own processing fee, so a refund leaves your co-op slightly out of pocket.
          </p>

          {refundError && (
            <p className="mb-3 text-sm text-red-600" role="alert">
              {refundError}
            </p>
          )}

          <ul className="divide-y divide-gray-100">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {t.buyerName || t.buyerEmail}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {money(t.amountCents)} · {new Date(t.createdAt).toLocaleDateString()}
                    {t.buyerName ? ` · ${t.buyerEmail}` : ''}
                  </p>
                </div>
                {t.refundedAt ? (
                  <span className="text-xs font-medium text-gray-400">
                    Refunded {new Date(t.refundedAt).toLocaleDateString()}
                  </span>
                ) : (
                  showTickets && (
                  /* Whoever runs the event (EVT-41). This was organisers
                     only; the person a buyer asks for their money back is
                     the host, and a host who has to go and find an organiser
                     is a host who stops selling tickets. The API checks the
                     same thing again. */
                  <button
                    type="button"
                    onClick={() => refund(t.id, t.buyerName || t.buyerEmail, t.amountCents)}
                    disabled={refunding === t.id}
                    className="btn-secondary text-sm"
                  >
                    {refunding === t.id ? 'Refunding...' : 'Refund'}
                  </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Who is waiting, and letting one of them in (EVT-41). Renders nothing
          unless somebody is actually waiting. */}
      {waitlist && waitlist.waiting.length > 0 && (
        <section className="card mt-6">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              Waitlist ({waitlist.waiting.length})
            </h2>
            {waitlist.spareSeats !== null && waitlist.spareSeats > 0 && (
              <span className="text-xs text-gray-500">
                {waitlist.spareSeats} place{waitlist.spareSeats === 1 ? '' : 's'} free
              </span>
            )}
          </div>
          <p className="mb-3 text-sm text-gray-500">
            In the order they asked. If somebody with a place cancels, the first here is given it
            automatically and told. Giving somebody a place by hand lets them in ahead of that.
          </p>

          {waitlistError && (
            <p className="mb-3 text-sm text-red-600" role="alert">
              {waitlistError}
            </p>
          )}

          <ul className="divide-y divide-gray-100">
            {waitlist.waiting.map((w) => (
              <li key={w.rsvpId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    <span className="mr-2 text-xs text-gray-400">{w.position}</span>
                    {w.name ?? 'A member'}
                    {w.plusOnes > 0 && (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        +{w.plusOnes} guest{w.plusOnes > 1 ? 's' : ''}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    Waiting since {new Date(w.joinedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => promote(w.rsvpId, w.name ?? 'this member')}
                  disabled={promoting === w.rsvpId}
                  className="btn-secondary text-sm"
                >
                  {promoting === w.rsvpId ? 'Giving a place…' : 'Give a place'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
