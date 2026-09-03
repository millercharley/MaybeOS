'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Calendar, MessageSquare, DoorOpen, Users } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { usePublicApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { HappeningNow } from '@/components/live/happening-now';
import { WelcomeCard } from '@/components/live/welcome-card';
import { PageHeader } from '@/components/layout/page-header';

export default function PortalHomePage() {
  const { orgSlug } = useParams();
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const basePath = `/portal/${orgSlug}`;

  const { data: events } = usePublicApi(
    () => (org ? api.events.listPublic(org.id) : Promise.resolve([])),
    [org?.id],
  );

  const upcoming = (events || [])
    .filter((e) => new Date(e.startTime) > new Date())
    .slice(0, 3);

  const features = [
    { label: 'Events', description: 'Browse and RSVP to upcoming events', href: `${basePath}/events`, icon: Calendar },
    { label: 'Rooms', description: 'Book shared spaces and meeting rooms', href: `${basePath}/rooms`, icon: DoorOpen },
    { label: 'Commons', description: 'Join discussions and vote on proposals', href: `${basePath}/commons`, icon: MessageSquare },
    { label: 'Directory', description: 'Find and connect with other members', href: `${basePath}/directory`, icon: Users },
  ];

  return (
    <div className="space-y-8">
      {/* Left, like every other heading in the product. `max-w-2xl` stays on
          the prose — that is a readable line length, not a centred layout, and
          dropping it would run a co-op's mission the full width of a large
          monitor. */}
      {/* Above the name and the mission, because somebody opening this on
          their phone outside the building wants to know whether to come in,
          not to be reminded what the co-op stands for. Both render nothing
          when there is nothing to say. */}
      {org && token && (
        <div className="space-y-4">
          <HappeningNow orgId={org.id} orgSlug={org.slug} />
          <WelcomeCard orgId={org.id} orgSlug={org.slug} />
        </div>
      )}

      <div>
        <h1 className="font-display text-2xl leading-tight text-ink">{org?.name}</h1>
        {org?.mission && (
          <p className="mt-3 max-w-2xl text-lg text-gray-600">{org.mission}</p>
        )}
        {org?.description && !org?.mission && (
          <p className="mt-3 max-w-2xl text-lg text-gray-600">{org.description}</p>
        )}
      </div>

      {upcoming.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Upcoming Events</h2>
            <Link href={`${basePath}/events`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((event) => (
              <div key={event.id} className="rounded-xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-medium text-brand-600">
                  {new Date(event.startTime).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-gray-900">{event.title}</h3>
                {event.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{event.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Explore</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Link
              key={f.label}
              href={f.href}
              className="group rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-brand-300"
            >
              <f.icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-brand-700">
                {f.label}
              </h3>
              <p className="mt-1 text-xs text-gray-500">{f.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
