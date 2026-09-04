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
  Users,
  MapPin,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { Panel } from '@/components/layout/panel';
import { happeningToday, whenLabel, startsIn } from '@/lib/event-list';

const quickLinksFor = (orgSlug: string) => [
  { label: 'My RSVPs', href: `/member/${orgSlug}/rsvps`, icon: Calendar },
  { label: 'My Bookings', href: `/member/${orgSlug}/bookings`, icon: DoorOpen },
  { label: 'My Profile', href: `/member/${orgSlug}/profile`, icon: User },
];

/**
 * A member's dashboard, led by the co-op rather than by the member (DSH-01).
 *
 * Charley, 2026-09-04: use the top to headline what is going on at the
 * community in general, showing today's events; move My Membership to a panel
 * at the side under Quick Links.
 *
 * The old page opened with the reader's own membership tier and status, which
 * is the least urgent thing on it — a fact that changes once a year, above the
 * fold, every single day. What changes daily is what is on at the space and how
 * many people are in the co-op, and that now leads.
 *
 * The banner and the goal are both optional and both stay absent rather than
 * becoming placeholders: a co-op that has set no goal shows its membership as a
 * plain number, because "47 members" is a fact while "47 of 100" is a claim
 * about what the co-op is for.
 */
export default function MemberPortalPage() {
  const orgSlug = useParams()?.orgSlug as string;
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

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

  // The co-op's own list, not the public one: a new event defaults to
  // MEMBERS_ONLY, and this is a member reading their own co-op's dashboard.
  const { data: events, loading: eventsLoading } = useApi(
    (token, orgId) => api.events.listVisible(orgId, token),
    [],
  );

  const { data: stats } = useApi((token, orgId) => api.dashboard.memberStats(orgId, token), []);

  // Everything the co-op has chosen to show rides on the session (DSH-01), so
  // the dashboard is not four requests deep before it can draw its own header.
  const currentOrg = user?.orgs?.find((o) => o.org?.slug === orgSlug) ?? user?.orgs?.[0];
  const org = currentOrg?.org;
  const memberName = user?.name || user?.email || 'Member';
  // `currentOrg.orgName` never existed on the API response — the membership
  // carries a nested `org`. So this always fell through to the placeholder,
  // and every member's dashboard greeted them with "Your Organization"
  // instead of the name of their co-op.
  const orgName = org?.name || 'Your Organization';
  const tierName = currentOrg?.role || 'Member';
  const subscriptionStatus = currentOrg?.subscriptionStatus || 'active';
  const statusDisplay = subscriptionStatus.charAt(0).toUpperCase() + subscriptionStatus.slice(1);

  // The co-op's own timezone decides what "today" means, not the reader's — at
  // 10pm in California, tonight in New York is already tomorrow. It rides on
  // the session with the rest of the co-op's identity; the fallback matches the
  // column's own default and only applies to a session issued before this
  // field was selected.
  const timezone = org?.timezone || 'America/New_York';
  const now = new Date();
  const today = happeningToday(events ?? [], timezone, now);
  // What to say when today is empty. "Nothing on today" alone is a dead end;
  // the next thing coming up is the answer to the question behind the question.
  const nextUp = (events ?? [])
    .filter((e) => new Date(e.startTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

  const goal = org?.memberGoal ?? null;
  const total = stats?.total ?? null;
  const progress =
    goal && total !== null ? Math.min(100, Math.round((total / goal) * 100)) : null;

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 lg:px-8">
      {/* The headline is the one thing that sits on the co-op's colour
          (BRD-02); its description belongs with it rather than loose below. */}
      <header className="mb-6">
        <h1 className="font-display text-2xl leading-tight text-ink">
          Welcome back, {memberName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          What&apos;s happening at {orgName}.
        </p>
      </header>

      {/* The co-op's own banner, when it has set one (DSH-01). No placeholder
          when it has not — an empty grey rectangle across the top of every
          member's dashboard is worse than no banner at all. */}
      {org?.bannerUrl && (
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={org.bannerUrl}
            alt=""
            className="h-36 w-full object-cover sm:h-48 lg:h-56"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* What is on at the space today — the top of the page, and the one
              thing here that is different every morning. */}
          <Panel
            title={`Today at ${orgName}`}
            actions={
              <Link
                href={`/member/${orgSlug}/events`}
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                All events
              </Link>
            }
          >
            {eventsLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
              </div>
            ) : today.length === 0 ? (
              <div className="py-4">
                <p className="text-sm text-gray-500">Nothing on today.</p>
                {nextUp && (
                  <p className="mt-1 text-sm text-gray-500">
                    Next up:{' '}
                    <Link
                      href={`/portal/${orgSlug}/events/${nextUp.slug}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {nextUp.title}
                    </Link>
                    , {whenLabel(nextUp.startTime, nextUp.endTime, nextUp.timezone || timezone)}.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {today.map((event) => {
                  const soon = startsIn(event.startTime, now);
                  const underway = new Date(event.startTime) <= now;
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/portal/${orgSlug}/events/${event.slug}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-brand-300"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">
                            {event.title}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {whenLabel(
                                event.startTime,
                                event.endTime,
                                event.timezone || timezone,
                              )}
                            </span>
                            {(event.room?.name || event.location?.name) && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {event.room?.name || event.location?.name}
                              </span>
                            )}
                          </span>
                        </span>
                        {underway ? (
                          <span className="badge-success shrink-0">Happening now</span>
                        ) : (
                          soon && (
                            <span className="shrink-0 text-xs font-medium text-gray-500">
                              {soon}
                            </span>
                          )
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="My Upcoming Events">
            {rsvpsLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
              </div>
            ) : upcomingRsvps.length === 0 ? (
              <div className="py-6 text-center">
                <Calendar className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-3 text-sm text-gray-500">
                  You haven&apos;t RSVPed to anything coming up.
                </p>
                <Link
                  href={`/member/${orgSlug}/events`}
                  className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Browse upcoming events
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {upcomingRsvps.map((rsvp) => (
                  <li key={rsvp.id}>
                    <Link
                      href={`/member/${orgSlug}/rsvps`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-brand-300"
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
          </Panel>

          <Panel title="My Bookings">
            <div className="space-y-3">
              {bookingsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
                </div>
              ) : !bookings || bookings.length === 0 ? (
                <div className="py-6 text-center">
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
                  const isApproved =
                    booking.status === 'APPROVED' ||
                    booking.status === 'approved' ||
                    booking.status === 'confirmed';

                  return (
                    <div
                      key={booking.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-4"
                    >
                      {/* Room, date and time take the whole row on a phone and
                          the status wraps under them. Sharing one row at 375px
                          squeezed this block to fifty pixels, which broke
                          "Meeting Room A" over three lines and the date apart
                          word by word. */}
                      <div className="flex min-w-0 basis-full items-center gap-4 sm:basis-0 sm:flex-1">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50">
                          <DoorOpen className="h-6 w-6 text-purple-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900">{roomName}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 shrink-0" />
                              {dateStr}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              {timeStr}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="ml-16 sm:ml-0">
                        {isApproved ? (
                          <span className="badge-success inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Approved
                          </span>
                        ) : (
                          <span className="badge-warning inline-flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {booking.status.charAt(0).toUpperCase() +
                              booking.status.slice(1).toLowerCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="Active Surveys">
            <div className="py-4 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm font-medium">No active surveys</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                When surveys are available, they will appear here.
              </p>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          {/* How many of us there are — and, only if the co-op said so, how
              many it is aiming for. */}
          <Panel title="Our community">
            <div className="flex items-baseline gap-2">
              <Users className="h-5 w-5 shrink-0 self-center text-gray-400" />
              <span className="text-3xl font-semibold text-gray-900">
                {total === null ? '—' : total}
              </span>
              <span className="text-sm text-gray-500">
                {total === 1 ? 'member' : 'members'}
                {goal ? ` of ${goal}` : ''}
              </span>
            </div>

            {progress !== null && (
              <div className="mt-4">
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Membership goal: ${total} of ${goal}`}
                >
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {/* Past the goal is a real outcome and reads as one, rather
                      than as a bar stuck at 100% with no explanation. */}
                  {total !== null && total >= (goal ?? 0)
                    ? `Goal of ${goal} reached.`
                    : `${progress}% of the way to ${goal}.`}
                </p>
              </div>
            )}

            {stats?.joinedThisMonth ? (
              <p className="mt-3 text-sm text-gray-500">
                {stats.joinedThisMonth} joined this month.
              </p>
            ) : null}
          </Panel>

          <Panel title="Quick Links" bodyClassName="-mt-1">
            <nav className="space-y-1">
              {quickLinksFor(orgSlug).map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <link.icon className="h-5 w-5 text-gray-400" />
                  <span className="flex-1">{link.label}</span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </Link>
              ))}
            </nav>
          </Panel>

          {/* Under Quick Links, at the side (Charley, 2026-09-04). It was the
              first thing on the page and is the slowest-changing thing on it. */}
          <Panel
            title="My Membership"
            description={orgName}
            actions={<span className="badge-success">{statusDisplay}</span>}
          >
            <dl className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <dt className="text-sm text-gray-500">Tier</dt>
                <dd className="text-sm font-semibold text-gray-900">{tierName}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <dt className="text-sm text-gray-500">Member since</dt>
                <dd className="text-sm font-semibold text-gray-900">
                  {/* Printed "--" for everyone, on a value the session has
                      carried all along. */}
                  {currentOrg?.memberSince
                    ? new Date(currentOrg.memberSince).toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })
                    : '—'}
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-gray-200 pt-4">
              <Link
                href={`/member/${orgSlug}/billing`}
                className="btn-secondary inline-flex items-center gap-2 text-sm"
              >
                <CreditCard className="h-4 w-4" />
                Manage Billing
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
