'use client';

import { useState } from 'react';
import { Calendar, MapPin, Users } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

export default function PortalEventsPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [rsvpingId, setRsvpingId] = useState<string | null>(null);
  const [rsvpDone, setRsvpDone] = useState<Set<string>>(new Set());

  const { data: events, loading } = usePublicApi(
    () => (org ? api.events.listPublic(org.id) : Promise.resolve([])),
    [org?.id],
  );

  async function handleRsvp(eventId: string) {
    if (!token || !org) return;
    setRsvpingId(eventId);
    try {
      await api.events.rsvp(org.id, eventId, token);
      setRsvpDone((prev) => new Set(prev).add(eventId));
    } catch {
      // ignore
    } finally {
      setRsvpingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const eventList = events || [];
  const upcoming = eventList.filter((e) => new Date(e.startTime) > new Date());
  const past = eventList.filter((e) => new Date(e.startTime) <= new Date());

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Events</h1>

      {upcoming.length === 0 && past.length === 0 && (
        <p className="py-12 text-center text-sm text-gray-500">No events yet.</p>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Upcoming</h2>
          <div className="space-y-4">
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-5"
              >
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-900">{event.title}</h3>
                  {event.description && (
                    <p className="mt-1 text-sm text-gray-500 line-clamp-2">{event.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(event.startTime).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {event.capacity && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {event.rsvpCount ?? 0} / {event.capacity}
                      </span>
                    )}
                    {event.category && (
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        {event.category}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  {token ? (
                    rsvpDone.has(event.id) ? (
                      <span className="text-sm font-medium text-green-600">RSVP'd</span>
                    ) : (
                      <button
                        onClick={() => handleRsvp(event.id)}
                        disabled={rsvpingId === event.id}
                        className="btn-primary text-sm"
                      >
                        {rsvpingId === event.id ? 'Sending...' : 'RSVP'}
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-gray-400">Sign in to RSVP</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Past Events</h2>
          <div className="space-y-3">
            {past.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-gray-100 bg-white p-4 opacity-70"
              >
                <h3 className="text-sm font-medium text-gray-700">{event.title}</h3>
                <p className="mt-1 text-xs text-gray-400">
                  {new Date(event.startTime).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
