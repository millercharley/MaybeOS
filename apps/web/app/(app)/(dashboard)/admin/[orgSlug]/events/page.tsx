'use client';

import { useParams } from 'next/navigation';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Users, Clock, Eye, EyeOff, X, Lock, Pencil, Trash2, Ticket, UserCircle } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { adminEventWindow, hostLine, ticketLine } from '@/lib/event-list';
import { api, Event } from '@/lib/api';
import { toUpdatePayload } from '@/lib/events';
import { EventForm, EventFormValues } from '@/components/events/event-form';
import { PageHeader } from '@/components/layout/page-header';
import { useReveal } from '@/hooks/use-reveal';

type FilterTab = 'all' | 'upcoming' | 'past' | 'draft';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'draft', label: 'Draft' },
];

export default function EventsPage() {
  const orgSlug = useParams()?.orgSlug as string;
  // What is coming, not everything that ever happened (EVT-31). A console
  // for 777 events opened on November 2024, which is nobody's first question.
  const [activeTab, setActiveTab] = useState<FilterTab>('upcoming');
  const [creating, setCreating] = useState(false);
  // The event being edited, or null. Editing did not exist at all: the only
  // route off this page was the door list, so an event created with the wrong
  // date, price or visibility could never be corrected — only cancelled.
  const [editing, setEditing] = useState<Event | null>(null);
  // The form sits above the event list, so Edit on a later event changes
  // something off the top of the screen (UI-04).
  const eventFormRef = useReveal<HTMLElement>(creating ? 'new' : (editing?.id ?? null));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  /** Which event is a click away from being destroyed (EVT-30). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  /*
    The tab decides which stretch of the calendar to ask for (EVT-27).

    This asked for the default — twenty events, ascending from the start of
    the co-op's history — and filtered them here. After MaybeItsFate imported
    777, Upcoming filtered twenty evenings from November 2024 and found
    nothing, on a console whose whole job is showing an organiser their
    events.
  */
  const { data: eventsData, loading, error, refetch } = useApi(
    (token, orgId) => api.events.list(orgId, token, adminEventWindow(activeTab, new Date())),
    [activeTab],
  );

  // The form quotes real ticket fees, so it needs the co-op's plan and whether
  // Stripe onboarding is finished (EVT-06).
  const { data: org } = useApi((token, orgId) => api.orgs.get(orgId, token), []);

  /*
    Arriving here to edit one event (EVT-35).

    The event page's Edit sends an organiser back with `?edit=<id>`, so they
    land on the form rather than on a list of 209 cards with theirs somewhere
    in it. Runs once the events are loaded, because the form needs the event.
  */
  useEffect(() => {
    if (typeof window === 'undefined' || !eventsData) return;
    const wanted = new URLSearchParams(window.location.search).get('edit');
    if (!wanted) return;

    const match = (eventsData.data ?? []).find((e) => e.id === wanted);
    if (match) {
      setCreating(false);
      setEditing(match);
      // Taken out of the address, so a refresh does not reopen it and the
      // back button does not either.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [eventsData]);


  // An organiser usually creates an event on somebody else's behalf, which is
  // the case EVT-04's host column exists for.
  const { data: members } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 100),
    [],
  );

  async function saveEdit(values: EventFormValues) {
    if (!token || !orgId || !editing) return;
    setBusy(true);
    setFormError('');
    try {
      // `publish` is a create-only field: UpdateEventDto does not accept it and
      // the API rejects the whole request with "property publish should not
      // exist", so an edit failed outright rather than saving. Publishing is
      // its own endpoint precisely because going live is a distinct act from
      // correcting a date.
      await api.events.update(orgId, editing.id, toUpdatePayload(values), token);

      // Editing a draft and choosing publish should still publish it.
      if (values.publish && !editing.isPublished) {
        await api.events.publish(orgId, editing.id, token);
      }

      setEditing(null);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  async function create(values: EventFormValues) {
    if (!token || !orgId) return;
    setBusy(true);
    setFormError('');
    try {
      await api.events.create(orgId, values, token);
      setCreating(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create that');
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

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load events: {error}
      </div>
    );
  }

  const events = eventsData?.data ?? [];
  const now = new Date();

  /** Hiding and deleting (EVT-30). */
  async function hideEvent(eventId: string) {
    if (!token || !orgId) return;
    setBusy(true);
    setFormError('');
    try {
      await api.events.unpublish(orgId, eventId, token);
      refetch();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not hide that event');
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(eventId: string) {
    if (!token || !orgId) return;
    setBusy(true);
    setFormError('');
    try {
      await api.events.remove(orgId, eventId, token);
      setConfirmDelete(null);
      refetch();
    } catch (err) {
      // The API refuses one somebody is expecting and says how many. That
      // sentence is the whole value of the refusal.
      setFormError(err instanceof Error ? err.message : 'Could not delete that event');
    } finally {
      setBusy(false);
    }
  }

  const filtered = events.filter((event) => {
    const isPast = new Date(event.startTime) < now;
    if (activeTab === 'upcoming') return !isPast && event.isPublished;
    if (activeTab === 'past') return isPast;
    if (activeTab === 'draft') return !event.isPublished;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Events"
        />{/* This button has had no handler since the page was built (EVT-07),
            so organisers — the people most likely to be programming events —
            were the only ones who could not make one. */}
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Event
          </button>
        )}
      </div>

      {(creating || editing) && (
        <section ref={eventFormRef} tabIndex={-1} className="card focus:outline-none">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              {editing ? `Edit ${editing.title}` : 'New event'}
            </h2>
            <button
              type="button"
              onClick={() => { setCreating(false); setEditing(null); }}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <EventForm
            // Remounted per event so the fields reload; without the key, React
            // keeps the previous event's state and an edit silently opens on
            // the wrong values.
            key={editing?.id ?? 'new'}
            initial={editing ?? undefined}
            alreadyPublished={Boolean(editing?.isPublished)}
            submitLabel={editing ? 'Save changes' : 'Create event'}
            busy={busy}
            error={formError}
            onSubmit={editing ? saveEdit : create}
            onCancel={() => { setCreating(false); setEditing(null); }}
            plan={org?.plan ?? 'FREE'}
            orgFeeCents={org?.ticketFeeCents ?? 0}
            canSellTickets={Boolean(org?.stripeChargesEnabled)}
            hosts={(members?.data ?? []).map((m) => ({
              id: m.user.id,
              name: m.user.name || m.user.email || 'Member',
            }))}
            orgId={orgId ?? undefined}
            token={token ?? undefined}
          />
        </section>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-brand-600 text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((event) => {
          const startDate = new Date(event.startTime);
          const endDate = new Date(event.endTime);
          const dateStr = startDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          const timeStr = `${startDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })} - ${endDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}`;
          const rsvpCount = event.rsvpCount ?? 0;
          const capacity = event.capacity ?? 0;

          return (
            // The card has looked clickable since it was built and led
            // nowhere. It now opens the door list (IMP-10).
            <Link
              key={event.id}
              href={`/admin/${orgSlug}/events/${event.id}`}
              className="card block cursor-pointer transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900">{event.title}</h3>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    event.isPublished
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {event.isPublished ? 'Published' : 'Draft'}
                </span>
              </div>

              <div className="space-y-2 text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{dateStr} &middot; {timeStr}</span>
                </div>
                {/* Who is running it, not where (EVT-35). At a co-op with
                    one building the location is the same words on every card,
                    and "TBD" on the many that never set one. */}
                <div className="flex items-center gap-2">
                  <UserCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate">{hostLine(event)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>
                    {rsvpCount}{capacity > 0 ? ` / ${capacity}` : ''} RSVPs
                  </span>
                </div>
                {ticketLine(event) && (
                  <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 shrink-0" />
                    <span>{ticketLine(event)}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  // Inside the card's <Link>: without both of these, editing
                  // navigates to the door list instead of opening the form.
                  e.preventDefault();
                  e.stopPropagation();
                  setCreating(false);
                  setEditing(event);
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-600"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>

              {/* Hiding and deleting (EVT-30). Inside the card's <Link>, so
                  both handlers have to stop the navigation the way Edit
                  above does. */}
              {event.isPublished && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hideEvent(event.id);
                  }}
                  disabled={busy}
                  className="ml-4 mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-600 disabled:opacity-50"
                >
                  <EyeOff className="h-3 w-3" /> Hide
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFormError('');
                  setConfirmDelete(confirmDelete === event.id ? null : event.id);
                }}
                disabled={busy}
                className="ml-4 mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>

              {confirmDelete === event.id && (
                <div
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
                >
                  <p className="text-xs text-red-900">
                    Delete “{event.title}” for good? This cannot be undone. If anyone is
                    expecting it, hide or cancel it instead.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => deleteEvent(event.id)}
                      disabled={busy}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {busy ? 'Deleting…' : 'Delete it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-3">
                {/* Three visibilities, and this drew two: everything that was
                    not PUBLIC was labelled "Members Only", so a PRIVATE event
                    told its organiser it was members-only. Charley created the
                    first real event, read this badge, and reasonably concluded
                    the portal was broken when it did not appear. */}
                {event.visibility === 'PUBLIC' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <Eye className="h-3 w-3" /> Public
                  </span>
                ) : event.visibility === 'MEMBERS_ONLY' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <EyeOff className="h-3 w-3" /> Members only
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <Lock className="h-3 w-3" /> Just you — not listed
                  </span>
                )}

                {capacity > 0 && (
                  <div className="ml-auto">
                    <div className="h-1.5 w-24 rounded-full bg-gray-200">
                      <div
                        className="h-1.5 rounded-full bg-brand-500"
                        style={{
                          width: `${Math.min((rsvpCount / capacity) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-gray-500">
            No events found for this filter.
          </div>
        )}
      </div>
    </div>
  );
}
