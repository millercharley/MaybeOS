'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Users, ArrowLeft, ExternalLink } from 'lucide-react';

const demoEvent = {
  title: 'Community Potluck',
  slug: 'community-potluck',
  access: 'public' as const,
  date: 'Saturday, March 1, 2025',
  time: '6:00 PM - 9:00 PM',
  location: 'Community Kitchen, 123 Main St',
  category: 'Food',
  description: `Join us for our monthly community potluck! This is a wonderful opportunity to meet your neighbors, share delicious food, and strengthen our community bonds.

Everyone is welcome to attend. Please bring a dish to share that serves 6-8 people. We'll have plates, utensils, and drinks provided.

This month's theme is "Comfort Foods From Around the World" - share your family's favorite comfort food recipe and the story behind it.

Dietary accommodations: Please label your dishes with common allergens. We'll have a designated table for gluten-free and vegan options.`,
  attendeeCount: 23,
  spotsRemaining: 5,
  maxCapacity: 28,
  orgName: 'Sunrise Community Space',
  orgSlug: 'sunrise-community-space',
};

export default function EventDetailPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const [rsvpName, setRsvpName] = useState('');
  const [rsvpEmail, setRsvpEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const event = demoEvent;

  const handleRsvp = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
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
            <span className="badge bg-orange-50 text-orange-700 ring-1 ring-orange-600/20">
              {event.category}
            </span>
            {event.access === 'members-only' && (
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
              <span className="text-lg">{event.date}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Clock className="h-5 w-5 text-brand-600" />
              <span className="text-lg">{event.time}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <MapPin className="h-5 w-5 text-brand-600" />
              <span className="text-lg">{event.location}</span>
            </div>
            <div className="flex items-center gap-3 text-gray-700">
              <Users className="h-5 w-5 text-brand-600" />
              <span className="text-lg">
                {event.attendeeCount} attending, {event.spotsRemaining} spots remaining
              </span>
            </div>
          </div>

          {/* Map Placeholder */}
          <div className="mt-8 flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
            <div className="text-center">
              <MapPin className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 text-sm text-gray-500">Map view coming soon</p>
              <p className="text-xs text-gray-400">{event.location}</p>
            </div>
          </div>

          {/* Description */}
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900">About this event</h2>
            <div className="mt-4 whitespace-pre-line text-gray-600 leading-relaxed">
              {event.description}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* RSVP Section */}
          <div className="card rounded-xl border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              {event.access === 'public' ? 'RSVP Now' : 'Member Event'}
            </h2>

            {/* Capacity Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-600">
                <span>{event.attendeeCount} attending</span>
                <span>{event.maxCapacity} max</span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-brand-600"
                  style={{
                    width: `${(event.attendeeCount / event.maxCapacity) * 100}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-sm font-medium text-brand-600">
                {event.spotsRemaining} spots remaining
              </p>
            </div>

            {event.access === 'public' ? (
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
                <p className="font-semibold text-gray-900">{event.orgName}</p>
                <Link
                  href={`/orgs/${event.orgSlug}`}
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
