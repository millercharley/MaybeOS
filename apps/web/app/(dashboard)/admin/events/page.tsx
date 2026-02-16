'use client';

import { useState } from 'react';
import { Plus, MapPin, Users, Clock, Eye, EyeOff } from 'lucide-react';

type EventStatus = 'PUBLISHED' | 'DRAFT';
type Visibility = 'PUBLIC' | 'MEMBERS_ONLY';
type FilterTab = 'all' | 'upcoming' | 'past' | 'draft';

interface Event {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  rsvpCount: number;
  capacity: number;
  visibility: Visibility;
  status: EventStatus;
  isPast: boolean;
}

const events: Event[] = [
  {
    id: '1',
    title: 'Community Potluck Dinner',
    date: 'Feb 20, 2026',
    time: '6:00 PM - 9:00 PM',
    location: 'Main Hall',
    rsvpCount: 42,
    capacity: 60,
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    isPast: false,
  },
  {
    id: '2',
    title: 'Board Meeting - Q1 Planning',
    date: 'Feb 25, 2026',
    time: '2:00 PM - 4:00 PM',
    location: 'Conference Room B',
    rsvpCount: 8,
    capacity: 12,
    visibility: 'MEMBERS_ONLY',
    status: 'PUBLISHED',
    isPast: false,
  },
  {
    id: '3',
    title: 'Workshop: Intro to Cooperative Governance',
    date: 'Jan 10, 2026',
    time: '10:00 AM - 12:00 PM',
    location: 'Studio A',
    rsvpCount: 25,
    capacity: 30,
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    isPast: true,
  },
  {
    id: '4',
    title: 'Summer Festival Planning',
    date: 'Mar 15, 2026',
    time: '3:00 PM - 5:00 PM',
    location: 'TBD',
    rsvpCount: 0,
    capacity: 50,
    visibility: 'MEMBERS_ONLY',
    status: 'DRAFT',
    isPast: false,
  },
];

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'draft', label: 'Draft' },
];

export default function EventsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filtered = events.filter((event) => {
    if (activeTab === 'upcoming') return !event.isPast && event.status === 'PUBLISHED';
    if (activeTab === 'past') return event.isPast;
    if (activeTab === 'draft') return event.status === 'DRAFT';
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
        {filtered.map((event) => (
          <div
            key={event.id}
            className="card cursor-pointer transition-shadow hover:shadow-md"
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-base font-semibold text-gray-900">{event.title}</h3>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  event.status === 'PUBLISHED'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {event.status === 'PUBLISHED' ? 'Published' : 'Draft'}
              </span>
            </div>

            <div className="space-y-2 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{event.date} &middot; {event.time}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>{event.location}</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span>
                  {event.rsvpCount} / {event.capacity} RSVPs
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

              <div className="ml-auto">
                <div className="h-1.5 w-24 rounded-full bg-gray-200">
                  <div
                    className="h-1.5 rounded-full bg-brand-500"
                    style={{
                      width: `${Math.min((event.rsvpCount / event.capacity) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-gray-500">
            No events found for this filter.
          </div>
        )}
      </div>
    </div>
  );
}
