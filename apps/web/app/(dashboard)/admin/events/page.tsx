'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, MapPin, Users, Clock, Eye, EyeOff } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

type FilterTab = 'all' | 'upcoming' | 'past' | 'draft';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'draft', label: 'Draft' },
];

export default function EventsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const { data: eventsData, loading, error } = useApi(
    (token, orgId) => api.events.list(orgId, token),
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
        <button className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Event
        </button>
      </div>

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
          const isPast = startDate < now;
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
