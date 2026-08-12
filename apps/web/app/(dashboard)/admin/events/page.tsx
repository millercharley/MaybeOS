'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, MapPin, Users, Clock, Eye, EyeOff, X } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import { EventForm, EventFormValues } from '@/components/events/event-form';

type FilterTab = 'all' | 'upcoming' | 'past' | 'draft';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'draft', label: 'Draft' },
];

export default function EventsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const { data: eventsData, loading, error, refetch } = useApi(
    (token, orgId) => api.events.list(orgId, token),
    [],
  );

  // The form quotes real ticket fees, so it needs the co-op's plan and whether
  // Stripe onboarding is finished (EVT-06).
  const { data: org } = useApi((token, orgId) => api.orgs.get(orgId, token), []);

  // An organiser usually creates an event on somebody else's behalf, which is
  // the case EVT-04's host column exists for.
  const { data: members } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 100),
    [],
  );

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

  const filtered = events.filter((event) => {
    const isPast = new Date(event.startTime) < now;
    if (activeTab === 'upcoming') return !isPast && event.isPublished;
    if (activeTab === 'past') return isPast;
    if (activeTab === 'draft') return !event.isPublished;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        {/* This button has had no handler since the page was built (EVT-07),
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

      {creating && (
        <section className="card">
          <div className="mb-4 flex items-center justify-between">
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
            error={formError}
            onSubmit={create}
            onCancel={() => setCreating(false)}
            plan={org?.plan ?? 'FREE'}
            orgFeeCents={org?.ticketFeeCents ?? 0}
            canSellTickets={Boolean(org?.stripeChargesEnabled)}
            hosts={(members?.data ?? []).map((m) => ({
              id: m.user.id,
              name: m.user.name || m.user.email || 'Member',
            }))}
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
              href={`/admin/events/${event.id}`}
              className="card block cursor-pointer transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between">
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
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{event.location?.name ?? 'TBD'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>
                    {rsvpCount}{capacity > 0 ? ` / ${capacity}` : ''} RSVPs
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                {event.visibility === 'PUBLIC' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <Eye className="h-3 w-3" /> Public
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <EyeOff className="h-3 w-3" /> Members Only
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
