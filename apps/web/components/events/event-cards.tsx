'use client';

import Link from 'next/link';
import { CalendarDays, DoorOpen, MapPin, Ticket, Users } from 'lucide-react';
import type { Event } from '@/lib/api';
import { eventArt } from '@/lib/event-art';
import { startsIn, whenLabel } from '@/lib/event-list';
import { RsvpFaces } from '@/components/events/rsvp-faces';
import { ticketCost, money } from '@/lib/fees';

/**
 * How an event appears in a list (EVT-19).
 *
 * The old list was a title, a date and a small square: the poster a co-op made
 * to advertise itself was 80 pixels wide beside two lines of grey text, and
 * every event looked the same whether it was tonight or in November.
 *
 * Two shapes, because a list answers two questions in order — what is on next,
 * and what is coming — and one card doing both makes the first invisible.
 */

/** Whether the viewer can act, and what happens when they do. */
export interface EventActions {
  orgSlug: string;
  isMember: boolean;
  busyId: string | null;
  rsvpStatus: Record<string, 'CONFIRMED' | 'WAITLISTED'>;
  errors: Record<string, string>;
  onRsvp: (eventId: string) => void;
  onBuy: (eventId: string) => void;
  /** The co-op's plan, for quoting the ticket total before Stripe. */
  plan?: string | null;
}

function RoomLine({ event }: { event: Event }) {
  // The room is the thing somebody has to find in the building, and it was
  // nowhere on the old card even when the event was published from a booking.
  if (!event.room?.name) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <DoorOpen size={13} aria-hidden="true" />
      {event.room.name}
    </span>
  );
}

function PlaceLine({ event }: { event: Event }) {
  const place = event.location?.name ?? event.location?.address;
  if (!place) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <MapPin size={13} aria-hidden="true" />
      {place}
    </span>
  );
}

/**
 * The action a viewer can take, which is not always an action.
 *
 * A ticketed event offers buying and nothing else: an RSVP beside a price is
 * two ways to say you are coming, one of which does not pay the co-op.
 */
function EventAction({ event, actions }: { event: Event; actions: EventActions }) {
  const status = actions.rsvpStatus[event.id];
  const error = actions.errors[event.id];
  const busy = actions.busyId === event.id;

  if (status) {
    return (
      <span className="whitespace-nowrap rounded-full border border-[var(--success)] px-4 py-2 text-sm font-medium">
        {status === 'CONFIRMED' ? 'Going' : 'On the waitlist'}
      </span>
    );
  }

  const control = event.priceCents ? (
    <button
      onClick={() => actions.onBuy(event.id)}
      disabled={busy}
      className="btn-primary inline-flex items-center gap-2 whitespace-nowrap"
    >
      <Ticket size={14} aria-hidden="true" />
      {busy
        ? 'Opening checkout…'
        : `Buy ticket · ${money(
            ticketCost({ ticketCents: event.priceCents, plan: actions.plan ?? undefined })
              .totalCents,
          )}`}
    </button>
  ) : actions.isMember ? (
    <button
      onClick={() => actions.onRsvp(event.id)}
      disabled={busy}
      className="btn-secondary whitespace-nowrap"
    >
      {busy ? 'Saving…' : 'RSVP'}
    </button>
  ) : (
    // A stranger on a public event page can still come; RSVP needs an account,
    // so the honest control is a link to the event rather than a dead button.
    <Link href={`/portal/${actions.orgSlug}/events/${event.slug}`} className="btn-secondary">
      Details
    </Link>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      {control}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

/**
 * The next thing happening, given the room it deserves.
 *
 * Everything below it is a row; this one is the page's answer to "is anything
 * on soon", which is the question most people open an events page with.
 */
export function NextEventCard({
  event,
  actions,
  now,
}: {
  event: Event;
  actions: EventActions;
  now: Date;
}) {
  const soon = startsIn(event.startTime, now);

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <Link href={`/portal/${actions.orgSlug}/events/${event.slug}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={eventArt(artOf(event))} alt="" className="h-56 w-full object-cover sm:h-64" />
      </Link>

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold">
              <Link
                href={`/portal/${actions.orgSlug}/events/${event.slug}`}
                className="hover:underline"
              >
                {event.title}
              </Link>
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {whenLabel(event.startTime, event.endTime, event.timezone)}
            </p>
          </div>
          <EventAction event={event} actions={actions} />
        </div>

        {event.description && (
          <p className="mt-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
            {event.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          {soon && (
            <span className="rounded-full bg-[var(--surface-sunken)] px-3 py-1 font-medium">
              {soon}
            </span>
          )}
          <span className="rounded-full bg-[var(--surface-sunken)] px-3 py-1">
            <RoomLine event={event} />
            {!event.room?.name && <PlaceLine event={event} />}
            {!event.room?.name && !event.location && 'In person'}
          </span>
          {event.hasCost && !event.priceCents && (
            // An event that charges at the door says so here, or the absence
            // of a ticket price reads as free.
            <span className="rounded-full bg-[var(--surface-sunken)] px-3 py-1">
              Cost at the door
            </span>
          )}
          {typeof event.rsvpCount === 'number' && event.rsvpCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-3 py-1">
              <Users size={13} aria-hidden="true" />
              {event.rsvpCount} going
            </span>
          )}
          {actions.isMember && event.rsvpFaces?.length ? (
            <RsvpFaces faces={event.rsvpFaces} total={event.rsvpCount ?? 0} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Everything after the next one. */
export function EventRow({ event, actions }: { event: Event; actions: EventActions }) {
  return (
    <li className="flex items-center gap-4 border-b border-[var(--border)] p-4 last:border-b-0">
      <Link href={`/portal/${actions.orgSlug}/events/${event.slug}`} className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={eventArt(artOf(event))}
          alt=""
          className="h-16 w-28 rounded-lg object-cover sm:h-20 sm:w-36"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <h4 className="truncate font-semibold">
          <Link
            href={`/portal/${actions.orgSlug}/events/${event.slug}`}
            className="hover:underline"
          >
            {event.title}
          </Link>
        </h4>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={13} aria-hidden="true" />
            {whenLabel(event.startTime, event.endTime, event.timezone)}
          </span>
          <RoomLine event={event} />
          {!event.room?.name && <PlaceLine event={event} />}
          {event.hasCost && !event.priceCents && <span>Cost at the door</span>}
        </p>
      </div>

      <div className="shrink-0">
        <EventAction event={event} actions={actions} />
      </div>
    </li>
  );
}

/** What the art generator needs, pulled off an event. */
function artOf(event: Event) {
  return {
    id: event.id,
    title: event.title,
    tags: event.tags,
    category: event.category,
    roomName: event.room?.name ?? null,
    imageUrl: event.imageUrl,
  };
}
