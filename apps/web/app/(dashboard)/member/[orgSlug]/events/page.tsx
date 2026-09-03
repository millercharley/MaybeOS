'use client';

import { useParams } from 'next/navigation';
import { RsvpFaces } from '@/components/events/rsvp-faces';
import { EventSummary } from '@/components/events/event-summary';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, Globe, Lock, Plus, Users, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, HostedEvent, Org } from '@/lib/api';
import { EventForm, EventFormValues } from '@/components/events/event-form';
import { MyRsvps } from '@/components/events/my-rsvps';
import { TouchpointAsk } from '@/components/impact/touchpoint-ask';
import { HostEarnings } from '@/components/events/host-earnings';

/**
 * A member's own events (EVT-05).
 *
 * The second of the two ways in Charley described: rather than booking a room
 * first, a member comes straight here and shares something. It is also the
 * only place a draft is visible — an unpublished event appears nowhere else,
 * so without this page it would be lost the moment you navigated away.
 */
export default function MyEventsPage() {
  const orgSlug = useParams()?.orgSlug as string;
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [events, setEvents] = useState<HostedEvent[]>([]);
  // The form quotes real fees, so it needs the co-op's plan and whether
  // Stripe onboarding is actually finished. Quoting a fee from a guess would
  // be worse than not quoting one.
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [mine, theOrg] = await Promise.all([
        api.events.myEvents(orgId, token),
        api.orgs.get(orgId, token),
      ]);
      setEvents(mine);
      setOrg(theOrg);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your events');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(values: EventFormValues) {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      await api.events.create(orgId, values, token);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that');
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent(eventId: string) {
    if (!token || !orgId) return;
    setBusy(true);
    try {
      await api.events.cancelEvent(orgId, eventId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel that');
    } finally {
      setBusy(false);
    }
  }

  async function publish(eventId: string) {
    if (!token || !orgId) return;
    setBusy(true);
    try {
      await api.events.publish(orgId, eventId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish that');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const upcoming = events.filter((e) => !e.isPast);
  const past = events.filter((e) => e.isPast);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Events</h1>
          <p className="mt-1 text-sm text-gray-500">
            Things you are running, and things you are going to. You can also{' '}
            <Link href={`/member/${orgSlug}/bookings`} className="text-brand-600 hover:underline">
              publish an event from a room booking
            </Link>
            .
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New event
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {creating && (
        <section className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">New event</h2>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <EventForm
            busy={busy}
            onSubmit={create}
            onCancel={() => setCreating(false)}
            plan={org?.plan ?? 'FREE'}
            orgFeeCents={org?.ticketFeeCents ?? 0}
            canSellTickets={Boolean(org?.stripeChargesEnabled)}
          />
        </section>
      )}

      {events.length === 0 && !creating ? (
        <div className="card py-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            You haven&apos;t made any events yet.
          </p>
        </div>
      ) : (
        <>
          <Section
            title="Coming up"
            events={upcoming}
            onCancel={cancelEvent}
            onPublish={publish}
            busy={busy}
          />
          {/* Only for somebody who has actually been to something. The PRD's
              post-event question is a follow-up, and asking it of a member
              with no past events is asking about an event that never
              happened. The visit is the moment rather than a scheduled
              nudge — a timed follow-up needs a notification MaybeOS does not
              send yet (IMP-19). */}
          {org && token && <HostEarnings orgId={org.id} token={token} />}

          {past.length > 0 && org && <TouchpointAsk orgId={org.id} touchpoint="POST_EVENT" />}

          {past.length > 0 && (
            <Section title="Past" events={past} onCancel={cancelEvent} onPublish={publish} busy={busy} muted />
          )}
        </>
      )}

      {/* Going, not just hosting. These were a separate page and a separate nav
          item, which split "what am I doing this month" across two screens and
          answered it on neither. */}
      <section className="border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Going</h2>
        <MyRsvps />
      </section>
    </div>
  );
}

function Section({
  title,
  events,
  onCancel,
  onPublish,
  busy,
  muted = false,
}: {
  title: string;
  events: HostedEvent[];
  onCancel: (id: string) => void;
  onPublish: (id: string) => void;
  busy: boolean;
  muted?: boolean;
}) {
  if (events.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
      <div className={`space-y-3 ${muted ? 'opacity-70' : ''}`}>
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            onCancel={onCancel}
            onPublish={onPublish}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

function EventRow({
  event,
  onCancel,
  onPublish,
  busy,
}: {
  event: HostedEvent;
  onCancel: (id: string) => void;
  onPublish: (id: string) => void;
  busy: boolean;
}) {
  // Its own, rather than threaded through props: the row is rendered in two
  // places and the URL already knows which co-op this is.
  const orgSlug = useParams()?.orgSlug as string;
  const orgId = useAuthStore((st) => st.currentOrgId);
  const [confirming, setConfirming] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const start = new Date(event.startTime);
  const canceled = Boolean((event as { canceledAt?: string | null }).canceledAt);
  const ended = Boolean(event.endTime && new Date(event.endTime) <= new Date());

  return (
    <div className="card space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{event.title}</p>
        <p className="mt-1 text-sm text-gray-500">
          {start.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {event.room?.name ? ` · ${event.room.name}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <VisibilityBadge visibility={event.visibility} />
          {canceled ? (
            <Badge tone="red">Cancelled</Badge>
          ) : event.isPublished ? (
            <Badge tone="green">Live</Badge>
          ) : (
            <Badge tone="grey">Draft — nobody can see it</Badge>
          )}
          {(event.rsvpFaces?.length ?? 0) > 0 ? (
            <RsvpFaces faces={event.rsvpFaces!} total={event.rsvpCount ?? 0} />
          ) : (
            <span className="text-gray-500">
              {event.rsvpCount ?? 0} going
              {event.capacity ? ` of ${event.capacity}` : ''}
            </span>
          )}
        </div>
      </div>

      {!canceled && (
        <div className="flex shrink-0 items-center gap-3 text-sm">
          {/* The host works the door, not an organiser. Published only: there
              is nobody to check in to an event nobody can see yet. */}
          {event.isPublished && (
            <Link
              href={`/member/${orgSlug}/events/${event.id}`}
              className="font-medium text-brand-600 hover:underline"
            >
              Check-in
            </Link>
          )}
          {!event.isPublished && (
            <button
              type="button"
              onClick={() => onPublish(event.id)}
              className="font-medium text-brand-600 hover:underline"
              disabled={busy}
            >
              Publish
            </button>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => onCancel(event.id)}
                className="font-semibold text-red-600 hover:underline"
                disabled={busy}
              >
                Yes, call it off
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-gray-500 hover:underline"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-gray-500 hover:text-red-600"
            >
              Cancel event
            </button>
          )}
        </div>
      )}
    </div>

    {/* Only after it has happened, and only on request — a host opening this
        list to publish next month's event does not need last month's takings
        expanded at them. */}
    {ended && !canceled && (
      showSummary && orgId ? (
        <EventSummary orgId={orgId} eventId={event.id} />
      ) : (
        <button
          type="button"
          onClick={() => setShowSummary(true)}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          How did it go?
        </button>
      )
    )}
    </div>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  // Named the way the form named it, so what somebody chose and what they are
  // later shown are the same words.
  if (visibility === 'PUBLIC') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Globe className="h-3 w-3" /> Anyone on the web
      </span>
    );
  }
  if (visibility === 'PRIVATE') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Lock className="h-3 w-3" /> Just you
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-gray-500">
      <Users className="h-3 w-3" /> Members only
    </span>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'red' | 'grey'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    grey: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
