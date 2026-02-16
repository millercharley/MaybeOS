'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, Clock, Search, Filter } from 'lucide-react';

type Event = {
  id: string;
  slug: string;
  title: string;
  access: 'public' | 'members-only';
  date: string;
  time: string;
  location: string;
  category: string;
};

const demoEvents: Event[] = [
  {
    id: '1',
    slug: 'community-potluck',
    title: 'Community Potluck',
    access: 'public',
    date: 'Sat, Mar 1, 2025',
    time: '6:00 PM',
    location: 'Community Kitchen',
    category: 'Food',
  },
  {
    id: '2',
    slug: 'board-meeting',
    title: 'Board Meeting',
    access: 'members-only',
    date: 'Mon, Mar 3, 2025',
    time: '7:00 PM',
    location: 'Main Hall',
    category: 'Governance',
  },
  {
    id: '3',
    slug: 'yoga-in-the-park',
    title: 'Yoga in the Park',
    access: 'public',
    date: 'Wed, Mar 5, 2025',
    time: '9:00 AM',
    location: 'City Park',
    category: 'Wellness',
  },
  {
    id: '4',
    slug: 'new-member-orientation',
    title: 'New Member Orientation',
    access: 'public',
    date: 'Fri, Mar 7, 2025',
    time: '5:00 PM',
    location: 'Welcome Room',
    category: 'Onboarding',
  },
  {
    id: '5',
    slug: 'cooperative-economics-workshop',
    title: 'Cooperative Economics Workshop',
    access: 'public',
    date: 'Sat, Mar 8, 2025',
    time: '2:00 PM',
    location: 'Library',
    category: 'Education',
  },
  {
    id: '6',
    slug: 'monthly-social',
    title: 'Monthly Social',
    access: 'members-only',
    date: 'Fri, Mar 14, 2025',
    time: '7:00 PM',
    location: 'Rooftop',
    category: 'Social',
  },
];

const categories = ['All', 'Food', 'Governance', 'Wellness', 'Onboarding', 'Education', 'Social'];

const categoryColors: Record<string, string> = {
  Food: 'bg-orange-50 text-orange-700 ring-1 ring-orange-600/20',
  Governance: 'bg-purple-50 text-purple-700 ring-1 ring-purple-600/20',
  Wellness: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',
  Onboarding: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
  Education: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
  Social: 'bg-pink-50 text-pink-700 ring-1 ring-pink-600/20',
};

export default function EventsPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [dateRange, setDateRange] = useState('all');

  const filtered = demoEvents.filter((event) => {
    const matchesSearch =
      event.title.toLowerCase().includes(search.toLowerCase()) ||
      event.location.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'All' || event.category === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Community Events</h1>
        <p className="mt-2 text-gray-600">
          Discover and RSVP to events happening in our community.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>

        {/* Category Dropdown */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input appearance-none pl-10 pr-8"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'All' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="input"
        >
          <option value="this-week">This Week</option>
          <option value="this-month">This Month</option>
          <option value="all">All Upcoming</option>
        </select>
      </div>

      {/* Events Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((event) => (
          <Link
            key={event.id}
            href={`/events/${event.slug}`}
            className="card group rounded-xl border border-gray-200 p-0 overflow-hidden transition hover:shadow-md"
          >
            {/* Card color strip */}
            <div className="h-2 bg-brand-600" />

            <div className="p-6">
              {/* Category & Access Badge */}
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`badge ${categoryColors[event.category] || 'bg-gray-50 text-gray-700 ring-1 ring-gray-600/20'}`}
                >
                  {event.category}
                </span>
                {event.access === 'members-only' && (
                  <span className="badge bg-brand-50 text-brand-700 ring-1 ring-brand-600/20">
                    Members Only
                  </span>
                )}
              </div>

              {/* Title */}
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">
                {event.title}
              </h3>

              {/* Details */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span>{event.date}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{event.time}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <span>{event.location}</span>
                </div>
              </div>

              {/* Action */}
              <div className="mt-5">
                {event.access === 'public' ? (
                  <span className="btn-primary w-full text-center">RSVP</span>
                ) : (
                  <span className="badge bg-gray-100 text-gray-600 ring-1 ring-gray-300 px-4 py-2 text-sm">
                    Members Only
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-lg font-medium text-gray-900">No events found</p>
          <p className="mt-1 text-sm text-gray-500">
            Try adjusting your filters or search terms.
          </p>
        </div>
      )}

      {/* Calendar Embed Snippet */}
      <div className="mt-16 rounded-xl border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Embed this calendar on your website</h2>
        <p className="mt-1 text-sm text-gray-600">
          Copy and paste the following code snippet to embed this event calendar on any website.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
          <code>{`<iframe
  src="${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/calendar"
  width="100%"
  height="600"
  frameBorder="0"
  title="Community Events Calendar"
></iframe>`}</code>
        </pre>
      </div>
    </div>
  );
}
