'use client';

import Link from 'next/link';
import {
  Calendar,
  Clock,
  MapPin,
  CreditCard,
  User,
  ClipboardList,
  DoorOpen,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const memberData = {
  name: 'Jordan Rivera',
  email: 'jordan@example.com',
  tier: 'Member',
  status: 'Active',
  since: 'January 15, 2024',
};

const upcomingEvents = [
  {
    title: 'Community Potluck',
    date: 'Sat, Mar 1, 2025',
    time: '6:00 PM',
    location: 'Community Kitchen',
    status: 'confirmed',
  },
  {
    title: 'Yoga in the Park',
    date: 'Wed, Mar 5, 2025',
    time: '9:00 AM',
    location: 'City Park',
    status: 'confirmed',
  },
  {
    title: 'Cooperative Economics Workshop',
    date: 'Sat, Mar 8, 2025',
    time: '2:00 PM',
    location: 'Library',
    status: 'waitlisted',
  },
];

const bookings = [
  {
    room: 'Conference Room A',
    date: 'Tue, Mar 4, 2025',
    time: '2:00 PM - 4:00 PM',
    status: 'approved',
  },
  {
    room: 'Workshop Studio',
    date: 'Thu, Mar 13, 2025',
    time: '10:00 AM - 12:00 PM',
    status: 'pending',
  },
];

const activeSurveys = [
  {
    title: 'Spring Programming Preferences',
    description: 'Help us plan upcoming workshops and events for the spring season.',
    dueDate: 'Mar 15, 2025',
  },
];

const quickLinks = [
  { label: 'My RSVPs', href: '/member/rsvps', icon: Calendar },
  { label: 'My Bookings', href: '/member/bookings', icon: DoorOpen },
  { label: 'My Profile', href: '/member/profile', icon: User },
];

export default function MemberPortalPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Welcome Message */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {memberData.name}!
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
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">My Membership</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Sunrise Community Space
                </p>
              </div>
              <span className="badge-success">{memberData.status}</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Tier</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {memberData.tier}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Status</p>
                <p className="mt-1 text-lg font-semibold text-green-700">
                  {memberData.status}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Member Since</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {memberData.since}
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-gray-200 pt-4">
              <Link
                href="/member/billing"
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
              {quickLinks.map((link) => (
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
        <div className="mt-4 space-y-3">
          {upcomingEvents.map((event) => (
            <div
              key={event.title}
              className="card flex items-center gap-4 rounded-xl border border-gray-200"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <Calendar className="h-6 w-6 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{event.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {event.date}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {event.time}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {event.location}
                  </span>
                </div>
              </div>
              <div>
                {event.status === 'confirmed' ? (
                  <span className="badge-success inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Confirmed
                  </span>
                ) : (
                  <span className="badge-warning inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Waitlisted
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* My Bookings */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">My Bookings</h2>
        <div className="mt-4 space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking.room + booking.date}
              className="card flex items-center gap-4 rounded-xl border border-gray-200"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50">
                <DoorOpen className="h-6 w-6 text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{booking.room}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {booking.date}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {booking.time}
                  </span>
                </div>
              </div>
              <div>
                {booking.status === 'approved' ? (
                  <span className="badge-success inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Approved
                  </span>
                ) : (
                  <span className="badge-warning inline-flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Pending
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Active Surveys */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">Active Surveys</h2>
        <div className="mt-4 space-y-3">
          {activeSurveys.map((survey) => (
            <div
              key={survey.title}
              className="card flex items-center gap-4 rounded-xl border border-gray-200"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <ClipboardList className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{survey.title}</p>
                <p className="mt-0.5 text-sm text-gray-500">{survey.description}</p>
                <p className="mt-1 text-xs text-gray-400">Due by {survey.dueDate}</p>
              </div>
              <Link href="/member/surveys" className="btn-primary flex-shrink-0">
                Take Survey
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
