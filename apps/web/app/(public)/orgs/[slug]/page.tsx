'use client';

import { use } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Users, Check, Star } from 'lucide-react';

const demoOrg = {
  name: 'Sunrise Community Space',
  slug: 'sunrise-community-space',
  mission:
    'A cooperatively-run community space dedicated to fostering connection, learning, and mutual aid. We believe in the power of community ownership and democratic governance to create thriving, equitable neighborhoods.',
  memberCount: 142,
  founded: '2021',
};

const tiers = [
  {
    name: 'Community',
    price: 'Free',
    period: '',
    description: 'Access to public events and resources.',
    benefits: [
      'RSVP to public events',
      'Community newsletter',
      'Access to public forums',
      'Event calendar',
    ],
    featured: false,
  },
  {
    name: 'Member',
    price: '$25',
    period: '/month',
    description: 'Full membership with voting rights.',
    benefits: [
      'Everything in Community',
      'Voting rights on proposals',
      'Book shared spaces',
      'Members-only events',
      'Member directory access',
      'Workshop discounts',
    ],
    featured: true,
  },
  {
    name: 'Sustainer',
    price: '$50',
    period: '/month',
    description: 'Support the community at a higher level.',
    benefits: [
      'Everything in Member',
      'Priority room bookings',
      'Free workshop access',
      'Sustainer recognition',
      'Quarterly dinner with board',
      'Guest passes (2/month)',
    ],
    featured: false,
  },
];

const upcomingEvents = [
  {
    title: 'Community Potluck',
    date: 'Sat, Mar 1',
    time: '6:00 PM',
    location: 'Community Kitchen',
    slug: 'community-potluck',
  },
  {
    title: 'Yoga in the Park',
    date: 'Wed, Mar 5',
    time: '9:00 AM',
    location: 'City Park',
    slug: 'yoga-in-the-park',
  },
  {
    title: 'Cooperative Economics Workshop',
    date: 'Sat, Mar 8',
    time: '2:00 PM',
    location: 'Library',
    slug: 'cooperative-economics-workshop',
  },
];

export default function OrgProfilePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Org Header */}
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-100">
          <span className="text-3xl font-bold text-brand-700">S</span>
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {demoOrg.name}
        </h1>
        <div className="mt-3 flex items-center justify-center gap-4 text-sm text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Users className="h-4 w-4" />
            {demoOrg.memberCount} members
          </span>
          <span>Founded {demoOrg.founded}</span>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-lg text-gray-600 leading-relaxed">
          {demoOrg.mission}
        </p>
      </div>

      {/* Membership Tiers */}
      <section className="mt-16">
        <h2 className="text-center text-2xl font-bold text-gray-900">Membership Tiers</h2>
        <p className="mt-2 text-center text-gray-600">
          Choose the membership level that works for you.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`card relative rounded-xl border-2 ${
                tier.featured
                  ? 'border-brand-600 shadow-lg'
                  : 'border-gray-200'
              }`}
            >
              {tier.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                    <Star className="h-3 w-3" />
                    Most Popular
                  </span>
                </div>
              )}

              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
                  {tier.period && (
                    <span className="text-sm text-gray-500">{tier.period}</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-500">{tier.description}</p>
              </div>

              <ul className="mt-8 space-y-3">
                {tier.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600" />
                    <span className="text-sm text-gray-700">{benefit}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Link
                  href="/register"
                  className={`w-full text-center ${
                    tier.featured ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  {tier.price === 'Free' ? 'Join Free' : `Join as ${tier.name}`}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming Events */}
      <section className="mt-16">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Upcoming Events</h2>
          <Link
            href="/events"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            View all events
          </Link>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {upcomingEvents.map((event) => (
            <Link
              key={event.slug}
              href={`/events/${event.slug}`}
              className="card group rounded-xl border border-gray-200 transition hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">
                {event.title}
              </h3>
              <div className="mt-3 space-y-2">
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
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
