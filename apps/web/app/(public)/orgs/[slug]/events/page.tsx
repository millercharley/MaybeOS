'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, CalendarPlus, Clock, MapPin, Ticket } from 'lucide-react';
import { usePublicApi } from '@/hooks/use-api';
import { api, apiUrl, type Event } from '@/lib/api';
import { monthHeading, groupUpcoming, whenLabel } from '@/lib/event-list';

/**
 * What is on, for somebody who has no account (PUB-05).
 *
 * Charley: "If the URL entry is left blank, show a single page of events that
 * do not require a logged in user to view, RSVP, and buy tickets in the brand
 * style of the community."
 *
 * All three already worked without an account — `listPublic` returns only
 * published public events, the ticket checkout is deliberately unguarded so a
 * stranger can buy one, and there has been a guest RSVP route since EventOS.
 * What was missing was a page that offered them. The only public events
 * listing was inside the portal, wrapped in the signed-in app's shell, with a
 * sidebar inviting a visitor to things they cannot reach.
 *
 * So this sits in `(public)`, beside the join page, and borrows that page's
 * look rather than the app's.
 */
export default function PublicEventsPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);

  const { data: org, loading: orgLoading } = usePublicApi(() => api.orgs.getBySlug(slug), [slug]);
  const { data: events, loading: eventsLoading } = usePublicApi(
    () => (org ? api.events.listPublic(org.id) : Promise.resolve([])),
    [org?.id],
  );

  /*
    Grouped by month, and `next` folded back in: that split exists for the
    portal, which gives the next event its own card. Here one unbroken list
    reads better — somebody scanning a public calendar is choosing between
    everything, not being pointed at one thing.
  */
  const months = useMemo(() => {
    const tz = org?.timezone ?? 'America/New_York';
    const grouped = groupUpcoming(events ?? [], tz, new Date());
    if (!grouped.next) return grouped.months;

    const first = grouped.months[0];
    const heading = monthHeading(grouped.next.startTime, tz);
    return first && first.heading === heading
      ? [{ heading, events: [grouped.next, ...first.events] }, ...grouped.months.slice(1)]
      : [{ heading, events: [grouped.next] }, ...grouped.months];
  }, [events, org?.timezone]);

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-gray-600">We could not find that community.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href={`/orgs/${slug}`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {org.name}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          <p className="mt-1 text-gray-600">
            Everything coming up at {org.name}. Anyone can come — you do not need an account.
          </p>
        </div>
        {/* The same feed the join page links to: public, published, uncancelled. */}
        <a
          href={apiUrl(`/orgs/${org.id}/events/feed.ics`)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
        >
          <CalendarPlus className="h-4 w-4" />
          Add to calendar
        </a>
      </div>

      {eventsLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      ) : months.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-gray-300 py-16 text-center">
          <Calendar className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 font-medium text-gray-900">Nothing on the calendar just yet.</p>
          <p className="mt-1 text-sm text-gray-500">
            {org.name} has nothing published at the moment. The calendar link above will tell you
            when they do.
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {months.map((month) => (
            <section key={month.heading}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                {month.heading}
              </h2>
              <div className="mt-4 space-y-4">
                {month.events.map((event) => (
                  <EventRow key={event.id} event={event} orgId={org.id} orgSlug={slug} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-16 border-t border-gray-200 pt-6 text-sm text-gray-500">
        Want to be part of it?{' '}
        <Link href={`/orgs/${slug}`} className="font-medium text-brand-600 hover:text-brand-700">
          Become a member of {org.name}
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * One event, and the thing a visitor can do about it.
 *
 * A ticket goes straight to Stripe, which collects the buyer's email itself.
 * A free event asks for a name and an address here, because an RSVP with
 * neither is a number rather than a person, and the host standing at the door
 * needs the person.
 */
function EventRow({ event, orgId, orgSlug }: { event: Event; orgId: string; orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | 'CONFIRMED' | 'WAITLISTED'>(null);
  const [error, setError] = useState('');

  const ticketed = (event.priceCents ?? 0) > 0;
  const where = event.room?.name || event.location?.name;

  async function rsvp() {
    if (!name.trim() || !email.trim()) {
      setError('We need a name and an email so the host knows who is coming.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.events.guestRsvp(orgId, event.id, {
        name: name.trim(),
        email: email.trim(),
      });
      // The API decides, and a full event with a waitlist says so rather than
      // refusing — telling somebody they have a place when they do not is the
      // one outcome worth avoiding here.
      setDone(result.status ?? 'CONFIRMED');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    setBusy(true);
    setError('');
    try {
      const here = window.location.href;
      const { url } = await api.events.buyTicket(orgId, event.id, {
        successUrl: `${here}?bought=1`,
        cancelUrl: here,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the checkout.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900">
            <Link
              href={`/portal/${orgSlug}/events/${event.slug}`}
              className="transition-colors hover:text-brand-700"
            >
              {event.title}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {whenLabel(event.startTime, event.endTime, event.timezone || 'America/New_York')}
            </span>
            {where && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {where}
              </span>
            )}
            {ticketed && (
              <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                <Ticket className="h-3.5 w-3.5" />${((event.priceCents ?? 0) / 100).toFixed(2)}
              </span>
            )}
          </div>
          {event.description && (
            <p className="mt-2 line-clamp-2 text-sm text-gray-600">{event.description}</p>
          )}
        </div>

        <div className="shrink-0">
          {done ? (
            <p className="text-sm font-medium text-gray-700">
              {done === 'WAITLISTED' ? 'You are on the waitlist' : "You're coming — see you there"}
            </p>
          ) : ticketed ? (
            <button type="button" onClick={buy} disabled={busy} className="btn-primary text-sm">
              {busy ? 'Opening…' : 'Buy a ticket'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="btn-secondary text-sm"
            >
              {open ? 'Cancel' : 'RSVP'}
            </button>
          )}
        </div>
      </div>

      {open && !done && !ticketed && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap gap-3">
            <input
              className="input min-w-[12rem] flex-1"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input min-w-[14rem] flex-1"
              type="email"
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="button" onClick={rsvp} disabled={busy} className="btn-primary text-sm">
              {busy ? 'Sending…' : 'Count me in'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Used to tell you about this event and nothing else.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
