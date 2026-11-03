'use client';

import { useParams } from 'next/navigation';

import Link from 'next/link';
import { Calendar, Clock, MapPin, Users } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useState } from 'react';
import { api, MyRsvp } from '@/lib/api';
import { EventTabs } from '@/components/events/event-tabs';
import { emptyNote, searchEvents, splitEvents, type EventTab } from '@/lib/event-tabs';

/**
 * What this member is going to (EVT-01).
 *
 * Was its own page and its own nav item. Charley, 2026-08-19: "Collapse My
 * RSVPs to inside My Events" — hosting something and going to something are
 * the same question asked twice, and splitting them across two screens meant
 * neither answered "what am I doing this month".
 *
 * Renders without a heading of its own: it sits under one now.
 */
export function MyRsvps() {
  const orgSlug = useParams()?.orgSlug as string;
  /** Upcoming or past, behind a tab, like every other event list (EVT-49). */
  const [tab, setTab] = useState<EventTab>('upcoming');
  const [search, setSearch] = useState('');
  const { data: rsvps, loading, error } = useApi(
    (token, orgId) => api.events.myRsvps(orgId, token),
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Couldn&apos;t load your RSVPs: {error}
      </div>
    );
  }

  const all = rsvps ?? [];

  /*
    Split by time, and only by time (EVT-49).

    This used to read `r.isPast || r.status === 'CANCELED'`, so an RSVP you
    cancelled for next Tuesday was filed under "Past and canceled" — the same
    conflation My Bookings had, where a reservation called off for a date
    that has not arrived sat under a heading saying "Past". What you did
    about an event is not when the event is, and the badge on the row already
    says "You canceled".
  */
  const { upcoming, past } = splitEvents(all, { timeOf: (r) => r.event });
  const shown = searchEvents(tab === 'past' ? past : upcoming, search, (r) => [
    r.event.title,
    r.event.room?.name,
    r.event.location?.name,
  ]);

  return (
    <div className="space-y-8">

      {all.length === 0 ? (
        <div className="card py-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-[var(--text-tertiary)]" />
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            You haven&apos;t RSVPed to anything yet.
          </p>
          <Link href={`/member/${orgSlug}/events`} className="btn-secondary mt-4 inline-block text-sm">
            Browse events
          </Link>
        </div>
      ) : (
        <>
          <EventTabs
            tab={tab}
            onTab={(next) => setTab(next as EventTab)}
            counts={{ upcoming: upcoming.length, past: past.length }}
            search={search}
            onSearch={setSearch}
            label="Which events you are going to"
            searchPlaceholder="Search what you are going to…"
          />
          <Section
            rsvps={shown}
            emptyNote={emptyNote(tab, Boolean(search.trim()))}
            muted={tab === 'past'}
          />
        </>
      )}
    </div>
  );
}

function Section({
  rsvps,
  emptyNote,
  muted = false,
}: {
  rsvps: MyRsvp[];
  emptyNote?: string;
  muted?: boolean;
}) {
  return (
    <section>
      {/* No heading of its own any more: the tab above says which list this
          is, and a heading reading "Past" under a pill reading "Past" says
          it twice (EVT-49). */}
      {rsvps.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{emptyNote}</p>
      ) : (
        <div className={`space-y-3 ${muted ? 'opacity-70' : ''}`}>
          {rsvps.map((rsvp) => (
            <RsvpCard key={rsvp.id} rsvp={rsvp} />
          ))}
        </div>
      )}
    </section>
  );
}

function RsvpCard({ rsvp }: { rsvp: MyRsvp }) {
  const orgSlug = useParams()?.orgSlug as string;
  const start = new Date(rsvp.event.startTime);
  const end = new Date(rsvp.event.endTime);

  // The event's own timezone, not the reader's browser: an event happens where
  // it happens, and a member travelling should not see the hour shift (SPC-08
  // fixed the same confusion in booking emails).
  const zone = rsvp.event.timezone || undefined;
  const day = start.toLocaleDateString('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = `${start.toLocaleTimeString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  })} – ${end.toLocaleTimeString('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })}`;

  const where = rsvp.event.room?.name || rsvp.event.location?.name;

  return (
    <div className="card flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Link
          href={`/member/${orgSlug}/events`}
          className="font-medium text-[var(--text-primary)] hover:text-brand-600"
        >
          {rsvp.event.title}
        </Link>
        <div className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[var(--text-tertiary)]" />
            {day}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--text-tertiary)]" />
            {time}
          </div>
          {where && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--text-tertiary)]" />
              {where}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <StatusBadge rsvp={rsvp} />
        {rsvp.plusOnes ? (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            <Users className="h-3 w-3" />+{rsvp.plusOnes} guest
            {rsvp.plusOnes > 1 ? 's' : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The org cancelling an event outranks the member's own status — being told
 * "you're confirmed" for something that is not happening is the worst of the
 * available messages.
 */
function StatusBadge({ rsvp }: { rsvp: MyRsvp }) {
  if (rsvp.eventCanceled) {
    return <Badge tone="red">Event canceled</Badge>;
  }
  if (rsvp.status === 'CANCELED') {
    return <Badge tone="grey">You canceled</Badge>;
  }
  if (rsvp.status === 'WAITLISTED') {
    return <Badge tone="amber">On the waitlist</Badge>;
  }
  if (rsvp.checkedIn) {
    return <Badge tone="green">Attended</Badge>;
  }
  return <Badge tone="green">Going</Badge>;
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'grey'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    grey: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
