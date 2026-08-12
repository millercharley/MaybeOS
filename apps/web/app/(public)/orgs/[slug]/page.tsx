'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Users, Check, Star } from 'lucide-react';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

export default function OrgProfilePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);

  // Fetch org by slug
  const { data: org, loading: orgLoading, error: orgError } = usePublicApi(
    () => api.orgs.getBySlug(slug),
    [slug]
  );

  // Fetch tiers once org is loaded
  const { data: tiers } = usePublicApi(
    () => org ? api.orgs.listTiers(org.id) : Promise.resolve([]),
    [org?.id]
  );

  const { data: events, loading: eventsLoading } = usePublicApi(
    () => org ? api.events.listPublic(org.id) : Promise.resolve([]),
    [org?.id]
  );

  // Take the first 3 upcoming events
  const upcomingEvents = useMemo(() => {
    if (!events) return [];
    return events
      .filter((e) => new Date(e.startTime) >= new Date())
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 3);
  }, [events]);

  const loading = orgLoading;

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );

  if (orgError || !org) return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center">
        <Users className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-4 text-lg font-medium text-gray-900">
          {orgError ? 'Failed to load organization' : 'Organization not found'}
        </p>
        {orgError && <p className="mt-1 text-sm text-gray-500">{orgError}</p>}
      </div>
    </div>
  );

  const logoInitial = org.name.charAt(0).toUpperCase();
  const displayTiers = tiers || org.tiers || [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Org Header */}
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-100">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={org.name} className="h-20 w-20 rounded-2xl object-cover" />
          ) : (
            <span className="text-3xl font-bold text-brand-700">{logoInitial}</span>
          )}
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {org.name}
        </h1>
        <div className="mt-3 flex items-center justify-center gap-4 text-sm text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Users className="h-4 w-4" />
            Community
          </span>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-lg text-gray-600 leading-relaxed">
          {org.mission || org.description || 'Welcome to our community.'}
        </p>
        <div className="mt-6">
          <Link
            href={`/portal/${slug}`}
            className="btn-primary inline-flex items-center gap-2"
          >
            Enter Member Portal
          </Link>
        </div>
      </div>

      {/* Membership Tiers */}
      {displayTiers.length > 0 && (
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold text-gray-900">Membership Tiers</h2>
          <p className="mt-2 text-center text-gray-600">
            {org.allowPublicJoin
              ? 'Choose the membership level that works for you.'
              : `${org.name} is invitation only. These are the membership levels — ask an organiser for an invite.`}
          </p>

          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {displayTiers.map((tier, index) => {
              const isFeatured = index === 1 && displayTiers.length >= 2;
              // toFixed(0) ROUNDED: a $19.50 tier advertised itself as "$20" on
              // the page that persuades someone to join, while Stripe charged
              // $19.50. Show whole dollars only when the price actually is whole.
              const priceDisplay =
                tier.priceMonthly === 0
                  ? 'Free'
                  : tier.priceMonthly % 100 === 0
                    ? `$${tier.priceMonthly / 100}`
                    : `$${(tier.priceMonthly / 100).toFixed(2)}`;
              const period = tier.priceMonthly > 0 ? '/month' : '';

              return (
                <div
                  key={tier.id}
                  className={`card relative rounded-xl border-2 ${
                    isFeatured
                      ? 'border-brand-600 shadow-lg'
                      : 'border-gray-200'
                  }`}
                >
                  {isFeatured && (
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
                      <span className="text-4xl font-bold text-gray-900">{priceDisplay}</span>
                      {period && (
                        <span className="text-sm text-gray-500">{period}</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      {tier.description || `Access as a ${tier.name} member.`}
                    </p>
                    {tier.isPayWhatYouCan && (
                      <p className="mt-1 text-xs text-brand-600 font-medium">
                        Pay what you can
                        {tier.minPrice
                          ? ` — from $${tier.minPrice % 100 === 0 ? tier.minPrice / 100 : (tier.minPrice / 100).toFixed(2)}`
                          : ''}
                      </p>
                    )}
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
                    {/*
                      Only offered when the co-op actually accepts public
                      joiners. The self-join endpoint refuses otherwise
                      (D-020), so showing "Join as X" on an invitation-only
                      co-op sent people to a page that could only tell them no.
                      Same family as the $19.50 tier that advertised itself as
                      "$20" — the public page must not promise what the backend
                      will not do.
                    */}
                    {org.allowPublicJoin ? (
                      <Link
                        href={`/join?org=${encodeURIComponent(slug)}&tier=${encodeURIComponent(tier.id)}`}
                        className={`w-full text-center ${
                          isFeatured ? 'btn-primary' : 'btn-secondary'
                        }`}
                      >
                        {priceDisplay === 'Free' ? 'Join Free' : `Join as ${tier.name}`}
                      </Link>
                    ) : (
                      <p className="text-center text-sm text-gray-500">
                        By invitation
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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

        {eventsLoading ? (
          <div className="mt-6 flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
          </div>
        ) : upcomingEvents.length === 0 ? (
          <div className="mt-6 text-center py-8">
            <Calendar className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No upcoming events</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingEvents.map((event) => {
              const startDate = new Date(event.startTime);
              const dateStr = startDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });
              const timeStr = startDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              });

              return (
                <Link
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="card group rounded-xl border border-gray-200 transition hover:shadow-md"
                >
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-brand-600 transition-colors">
                    {event.title}
                  </h3>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span>{dateStr}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span>{timeStr}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span>{event.location?.name || 'TBD'}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
