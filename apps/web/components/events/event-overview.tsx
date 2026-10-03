'use client';

import Link from 'next/link';
import {
  CalendarClock,
  DoorOpen,
  Eye,
  EyeOff,
  Lock,
  MapPin,
  MessageCircle,
  Ticket,
  Users,
} from 'lucide-react';
import type { Event, TicketSale } from '@/lib/api';
import { money } from '@/lib/fees';
import { MemberName } from '@/components/member/member-name';

/**
 * Everything an organiser needs to know about one event (EVT-31).
 *
 * The admin's event page was the door list and nothing else: a check-in
 * screen reached from a card that carried the title, the date and an RSVP
 * count. Charley, opening one of 777 imported events, had no way to see who
 * was running it, where, what it cost, or what had been sold — the questions
 * an organiser opens an event to answer.
 *
 * The host is the first of them, and reachable: an organiser looking at
 * somebody else's event usually wants to ask them something, and the answer
 * was to go and find them in the directory.
 */
export function EventOverview({
  event,
  orgSlug,
  tickets,
}: {
  event: Event;
  orgSlug: string;
  tickets?: TicketSale[];
}) {
  const start = new Date(event.startTime);
  const end = event.endTime ? new Date(event.endTime) : null;

  const day = start.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${
    end ? ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''
  }`;

  // Sold, and taken. Refunded sales stay in the list and out of the total:
  // an organiser asking "what did this make" means what it kept.
  const sold = (tickets ?? []).filter((t) => !t.refundedAt);
  const takenCents = sold.reduce((sum, t) => sum + (t.amountCents ?? 0), 0);

  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">{event.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 shrink-0" />
              {day} · {time}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {event.isPublished ? (
            <span className="badge-success">Published</span>
          ) : (
            <span className="badge-neutral">Hidden</span>
          )}
          <Visibility value={event.visibility} />
        </div>
      </div>

      {/* Who is running it, and a way to ask them something (EVT-31). */}
      <div className="rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Host</p>
        {event.host?.id ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">
              <MemberName userId={event.host.id} name={event.host.name ?? 'Member'} />
            </span>
            <Link
              href={`/portal/${orgSlug}/messages/${event.host.id}`}
              className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            >
              <MessageCircle className="h-4 w-4" />
              Message them
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            {event.hostName
              ? // Imported, and whoever ran it is not a member here (CAL-03).
                `${event.hostName} — not a member here, so there is nobody to message.`
              : 'Nobody is set as the host.'}
          </p>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact icon={MapPin} label="Where">
          {event.room?.name
            ? `${event.room.name}${event.location?.name ? ` · ${event.location.name}` : ''}`
            : (event.location?.name ?? 'Not set')}
        </Fact>

        <Fact icon={Users} label="RSVPs">
          {event.rsvpCount ?? 0}
          {event.capacity ? ` of ${event.capacity}` : ''}
        </Fact>

        <Fact icon={Ticket} label="Tickets">
          {event.priceCents
            ? `${money(event.priceCents)} each`
            : event.hasCost
              ? 'Charged at the door, not through MaybeOS'
              : 'Free'}
        </Fact>

        <Fact icon={DoorOpen} label="Room booking">
          {event.room?.name
            ? 'The room is held for this event'
            : 'No room is held through MaybeOS'}
        </Fact>
      </dl>

      {tickets !== undefined && (event.priceCents ?? 0) > 0 && (
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Ticket sales</p>
          <p className="mt-2 text-sm text-gray-900">
            <span className="font-semibold">{sold.length}</span> sold ·{' '}
            <span className="font-semibold">{money(takenCents)}</span> taken
            {tickets.length > sold.length && (
              <span className="text-gray-500">
                {' '}
                · {tickets.length - sold.length} refunded
              </span>
            )}
          </p>
        </div>
      )}

      {event.description && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{event.description}</p>
        </div>
      )}
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * Three visibilities, drawn as three (EVT-13). Everything that was not PUBLIC
 * once read "Members only", so a PRIVATE event told its organiser the wrong
 * thing about who could see it.
 */
function Visibility({ value }: { value: string }) {
  if (value === 'PUBLIC') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Eye className="h-3 w-3" /> Public
      </span>
    );
  }
  if (value === 'MEMBERS_ONLY') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <EyeOff className="h-3 w-3" /> Members only
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <Lock className="h-3 w-3" /> Private
    </span>
  );
}
