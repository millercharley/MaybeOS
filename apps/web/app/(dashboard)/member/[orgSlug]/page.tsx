'use client';

import { useParams } from 'next/navigation';

import Link from 'next/link';
import {
  Calendar,
  Clock,
  CreditCard,
  User,
  ClipboardList,
  DoorOpen,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

const quickLinksFor = (orgSlug: string) => [
  { label: 'My RSVPs', href: `/member/${orgSlug}/rsvps`, icon: Calendar },
  { label: 'My Bookings', href: `/member/${orgSlug}/bookings`, icon: DoorOpen },
  { label: 'My Profile', href: `/member/${orgSlug}/profile`, icon: User },
];

export default function MemberPortalPage() {
  const orgSlug = useParams()?.orgSlug as string;
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Fetch bookings from the API
  const { data: bookings, loading: bookingsLoading } = useApi(
    (token, orgId) => api.rooms.myBookings(orgId, token),
    []
  );

  // This section used to read "Coming soon — your RSVP'd events will appear
  // here once the feature is available", while /member/rsvps was live and
  // linked from the sidebar two rows above it (EVT-01). The dashboard was
  // telling members a working feature did not exist.
  const { data: rsvps, loading: rsvpsLoading } = useApi(
    (token, orgId) => api.events.myRsvps(orgId, token),
    []
  );
  const upcomingRsvps = (rsvps ?? [])
    .filter((r) => !r.isPast && !r.eventCanceled && r.status !== 'CANCELED')
    .slice(0, 3);

  // Derive member info from auth store
  const currentOrg = user?.orgs?.[0];
  const memberName = user?.name || user?.email || 'Member';
  // `currentOrg.orgName` never existed on the API response — the membership
  // carries a nested `org`. So this always fell through to the placeholder,
  // and every member's dashboard greeted them with "Your Organization"
  // instead of the name of their co-op.
  const orgName = currentOrg?.org?.name || 'Your Organization';
  const tierName = currentOrg?.role || 'Member';
  const subscriptionStatus = currentOrg?.subscriptionStatus || 'active';
  const statusDisplay = subscriptionStatus.charAt(0).toUpperCase() + subscriptionStatus.slice(1);

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 lg:px-8">
      {/* Welcome Message */}
      <div className="mb-8">
        <h1 className="font-display text-2xl leading-tight text-ink">
          Welcome back, {memberName}
        </h1>
        <p className="mt-1 text-gray-600">
          Here is an overview of your membership and upcoming activities.
        </p>
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Membership Card */}
        <div className="lg:col-span-2">
          <div className="card rounded-xl border border-gray-200">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">My Membership</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {orgName}
                </p>
              </div>
              <span className="badge-success">{statusDisplay}</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Tier</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {tierName}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Status</p>
                <p className="mt-1 text-lg font-semibold text-green-700">
                  {statusDisplay}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Member Since</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  --
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-gray-200 pt-4">
              <Link
                href={`/member/${orgSlug}/billing`}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <CreditCard className="h-4 w-4" />
                Manage Billing
              </Link>
            </div>
          </div>
        </div>

        {/* Right: Quick Links */}
        <div>
          <div className="card rounded-xl border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Quick Links</h2>
            <nav className="mt-4 space-y-2">
              {quickLinksFor(orgSlug).map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <link.icon className="h-5 w-5 text-gray-400" />
                  <span className="flex-1">{link.label}</span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* My Upcoming Events */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">My Upcoming Events</h2>
        <div className="mt-4">
          {rsvpsLoading ? (
            <div className="card rounded-xl border border-gray-200 py-8 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : upcomingRsvps.length === 0 ? (
            <div className="card rounded-xl border border-gray-200 py-8 text-center">
              <Calendar className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">
                You haven&apos;t RSVPed to anything coming up.
              </p>
              <Link href={`/member/${orgSlug}/events`} className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
                Browse upcoming events
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {upcomingRsvps.map((rsvp) => (
                <li key={rsvp.id}>
                  <Link
                    href={`/member/${orgSlug}/rsvps`}
                    className="card flex flex-wrap items-center justify-between rounded-xl border border-gray-200 hover:border-brand-300 gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {rsvp.event.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {new Date(rsvp.event.startTime).toLocaleDateString('en-US', {
                          timeZone: rsvp.event.timezone || undefined,
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {rsvp.status === 'WAITLISTED' && ' · on the waitlist'}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* My Bookings */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">My Bookings</h2>
        <div className="mt-4 space-y-3">
          {bookingsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
            </div>
          ) : !bookings || bookings.length === 0 ? (
            <div className="card rounded-xl border border-gray-200 text-center py-8">
              <DoorOpen className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-900">No bookings yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Book a room to see your reservations here.
              </p>
            </div>
          ) : (
            bookings.map((booking) => {
              const startDate = new Date(booking.startTime);
              const endDate = new Date(booking.endTime);
              const dateStr = startDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
              const timeStr = `${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
              const roomName = booking.room?.name || booking.title || 'Room';
              const isApproved = booking.status === 'APPROVED' || booking.status === 'approved' || booking.status === 'confirmed';

              return (
                <div
                  key={booking.id}
                  className="card flex items-center gap-4 rounded-xl border border-gray-200"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50">
                    <DoorOpen className="h-6 w-6 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{roomName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {dateStr}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {timeStr}
                      </span>
                    </div>
                  </div>
                  <div>
                    {isApproved ? (
                      <span className="badge-success inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Approved
                      </span>
                    ) : (
                      <span className="badge-warning inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {booking.status.charAt(0).toUpperCase() + booking.status.slice(1).toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Active Surveys */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Active Surveys</h2>
        <div className="mt-4 space-y-3">
          <div className="card rounded-xl border border-gray-200 text-center py-8">
            <ClipboardList className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-900">No active surveys</p>
            <p className="mt-1 text-sm text-gray-500">
              When surveys are available, they will appear here.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
