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
import { useState } from 'react';
import { api, type Event, type TicketSale } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { MemberPicker } from '@/components/member/member-picker';
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
  orgId,
  tickets,
  canManageHosts = false,
  onChanged,
}: {
  event: Event;
  orgSlug: string;
  orgId?: string;
  tickets?: TicketSale[];
  /**
   * Whether this reader may say who runs it (EVT-32) — an organiser, the
   * host, or whoever created it. The API decides the same thing again; this
   * keeps controls that would be refused off the screen.
   */
  canManageHosts?: boolean;
  onChanged?: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [changingHost, setChangingHost] = useState(false);
  const [addingCoHost, setAddingCoHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hostError, setHostError] = useState('');

  const coHosts = event.coHosts ?? [];

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setHostError('');
    try {
      await work();
      setChangingHost(false);
      setAddingCoHost(false);
      onChanged?.();
    } catch (err) {
      // The API refuses somebody who is not a member, the host added as their
      // own co-host, and a reader who may not decide this. Each says why.
      setHostError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }
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

      {/* Who is running it, and a way to ask them something (EVT-31, EVT-32). */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Host</p>
          {canManageHosts && orgId && (
            <button
              type="button"
              onClick={() => {
                setChangingHost(!changingHost);
                setAddingCoHost(false);
                setHostError('');
              }}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              {changingHost ? 'Cancel' : 'Change host'}
            </button>
          )}
        </div>

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

        {changingHost && orgId && (
          <div className="mt-3">
            <MemberPicker
              orgId={orgId}
              busy={busy}
              placeholder="Who should run this event?"
              exclude={event.host?.id ? [event.host.id] : []}
              onPick={(member) =>
                run(() => api.events.setHost(orgId, event.id, member.user.id, token ?? ''))
              }
            />
          </div>
        )}

        {/* Everyone else running it (EVT-32). */}
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Co-hosts
            </p>
            {canManageHosts && orgId && (
              <button
                type="button"
                onClick={() => {
                  setAddingCoHost(!addingCoHost);
                  setChangingHost(false);
                  setHostError('');
                }}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                {addingCoHost ? 'Cancel' : 'Add a co-host'}
              </button>
            )}
          </div>

          {coHosts.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Nobody else is running this one.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {coHosts.map((co) => (
                <li key={co.userId} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-gray-900">
                    <MemberName userId={co.userId} name={co.user.name ?? 'Member'} />
                  </span>
                  <span className="flex items-center gap-3">
                    <Link
                      href={`/portal/${orgSlug}/messages/${co.userId}`}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Message
                    </Link>
                    {canManageHosts && orgId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            api.events.removeCoHost(orgId, event.id, co.userId, token ?? ''),
                          )
                        }
                        className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {addingCoHost && orgId && (
            <div className="mt-3">
              <MemberPicker
                orgId={orgId}
                busy={busy}
                placeholder="Who else is running it?"
                exclude={[
                  ...(event.host?.id ? [event.host.id] : []),
                  ...coHosts.map((c) => c.userId),
                ]}
                onPick={(member) =>
                  run(() => api.events.addCoHost(orgId, event.id, member.user.id, token ?? ''))
                }
              />
            </div>
          )}
        </div>

        {hostError && <p className="mt-3 text-sm text-red-700">{hostError}</p>}
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
              ? // Paid at the door (EVT-34), with the figure if they gave one.
                event.suggestedCents
                ? `${money(event.suggestedCents)} suggested at the door`
                : 'Pay or donate at the door'
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
