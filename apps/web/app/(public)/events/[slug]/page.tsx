'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Users, ArrowLeft, ExternalLink } from 'lucide-react';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

export default function EventDetailPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const [rsvpName, setRsvpName] = useState('');
  const [rsvpEmail, setRsvpEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // One event, fetched by slug. This used to pull the whole public list and
  // find() through it — with the co-op's slug passed where the route parses a
  // UUID, so the request 400'd and the page never rendered an event at all.
  // TODO: the co-op is hardcoded, same as the list page above it.
  const { data: event, loading, error } = usePublicApi(
    () => api.events.getPublicBySlug('sunrise', slug),
    [slug]
  );

  const handleRsvp = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );

  if (error) return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/events"
        className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Events
      </Link>
      <div className="mt-6 text-center">
        <Calendar className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-4 text-lg font-medium text-gray-900">Failed to load event</p>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
      </div>
    </div>
  );

  if (!event) return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/events"
        className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Events
      </Link>
      <div className="mt-6 text-center">
        <Calendar className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-4 text-lg font-medium text-gray-900">Event not found</p>
        <p className="mt-1 text-sm text-gray-500">
          The event you are looking for does not exist or has been removed.
        </p>
      </div>
    </div>
  );

  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const access = event.visibility === 'MEMBERS_ONLY' ? 'members-only' : 'public';
  const dateStr = startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = `${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const locationStr = event.location?.name || 'TBD';
  const attendeeCount = event.rsvpCount || 0;
  const maxCapacity = event.capacity || 0;
  const spotsRemaining = maxCapacity > 0 ? Math.max(0, maxCapacity - attendeeCount) : null;

  const categoryColorMap: Record<string, string> = {
    Food: 'bg-orange-50 text-orange-700 ring-1 ring-orange-600/20',
    Governance: 'bg-purple-50 text-purple-700 ring-1 ring-purple-600/20',
    Wellness: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',
    Onboarding: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
    Education: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
    Social: 'bg-pink-50 text-pink-700 ring-1 ring-pink-600/20',
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Back Navigation */}
      <Link
        href="/events"
        className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Events
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Category Badge */}
          <div className="mb-4 flex items-center gap-2">
            {event.category && (
              <span className={`badge ${categoryColorMap[event.category] || 'bg-gray-50 text-gray-700 ring-1 ring-gray-600/20'}`}>
                {event.category}
              </span>
            )}
            {access === 'members-only' && (
              <span className="badge bg-brand-50 text-brand-700 ring-1 ring-brand-600/20">
                Members Only
              </span>
            )}
          </div>

          {/* Event Title */}
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            {event.title}
          </h1>

          {/* Date, Time, Location */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-gray-700">
              <Calendar className="h-5 w-5 text-brand-600" />
              <span className="text-lg">{dateStr}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Clock className="h-5 w-5 text-brand-600" />
              <span className="text-lg">{timeStr}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <MapPin className="h-5 w-5 text-brand-600" />
              <span className="text-lg">{locationStr}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Users className="h-5 w-5 text-brand-600" />
              <span className="text-lg">
                {attendeeCount} attending{spotsRemaining !== null ? `, ${spotsRemaining} spots remaining` : ''}
              </span>
            </div>
          </div>

          {/* Map Placeholder */}
          <div className="mt-8 flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
            <div className="text-center">
              <MapPin className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 text-sm text-gray-500">Map view coming soon</p>
              <p className="text-xs text-gray-400">{locationStr}</p>
            </div>
          </div>

          {/* Description */}
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900">About this event</h2>
            <div className="mt-4 whitespace-pre-line text-gray-600 leading-relaxed">
              {event.description || 'No description provided.'}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* RSVP Section */}
          <div className="card rounded-xl border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              {access === 'public' ? 'RSVP Now' : 'Member Event'}
            </h2>

            {/* Capacity Bar */}
            {maxCapacity > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{attendeeCount} attending</span>
                  <span>{maxCapacity} max</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-brand-600"
                    style={{
                      width: `${Math.min(100, (attendeeCount / maxCapacity) * 100)}%`,
                    }}
                  />
                </div>
                {spotsRemaining !== null && (
                  <p className="mt-1 text-sm font-medium text-brand-600">
                    {spotsRemaining} spots remaining
                  </p>
                )}
              </div>
            )}

            {access === 'public' ? (
              <>
                {submitted ? (
                  <div className="mt-6 rounded-lg bg-green-50 p-4 text-center">
                    <p className="font-medium text-green-800">You are RSVP'd!</p>
                    <p className="mt-1 text-sm text-green-600">
                      A confirmation has been sent to your email.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleRsvp} className="mt-6 space-y-4">
                    <div>
                      <label
                        htmlFor="name"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Your Name
                      </label>
                      <input
                        id="name"
                        type="text"
                        required
                        value={rsvpName}
                        onChange={(e) => setRsvpName(e.target.value)}
                        placeholder="Jane Doe"
                        className="input mt-1"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="email"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Email Address
                      </label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={rsvpEmail}
                        onChange={(e) => setRsvpEmail(e.target.value)}
                        placeholder="jane@example.com"
                        className="input mt-1"
                      />
                    </div>
                    <button type="submit" className="btn-primary w-full">
                      RSVP Now
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="mt-6 text-center">
                <p className="text-sm text-gray-600">
                  This event is for members only.
                </p>
                <Link href="/login" className="btn-primary mt-4 w-full">
                  Sign in to RSVP
                </Link>
              </div>
            )}
          </div>

          {/* Org Info */}
          <div className="card rounded-xl border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
              Hosted by
            </h3>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100">
                <span className="text-sm font-bold text-brand-700">S</span>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Sunrise Community Space</p>
                <Link
                  href="/orgs/sunrise"
                  className="text-sm text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                >
                  View organization
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
