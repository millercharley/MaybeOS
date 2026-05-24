'use client';

import Link from 'next/link';
import { Users, Calendar, DoorOpen, BarChart3, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

// TODO: Replace with real audit log API endpoint when available
const recentActivity = [
  { id: 1, text: 'Sarah Chen joined as a new member', time: '2 minutes ago' },
  { id: 2, text: '"Community Potluck" event published', time: '15 minutes ago' },
  { id: 3, text: 'Room booking for Studio A approved', time: '1 hour ago' },
  { id: 4, text: 'New proposal "Budget Reallocation" submitted', time: '3 hours ago' },
  { id: 5, text: 'Impact survey "Q4 Belonging" completed by 28 members', time: '5 hours ago' },
];

const quickActions = [
  { label: 'Create Event', href: '/admin/events', icon: Calendar },
  { label: 'Add Member', href: '/admin/members', icon: Users },
  { label: 'New Survey', href: '/admin/impact', icon: BarChart3 },
];

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data: membersData, loading: membersLoading } = useApi(
    (token, orgId) => api.members.list(orgId, token, 1, 1),
    [],
  );

  const { data: eventsData, loading: eventsLoading } = useApi(
    (token, orgId) => api.events.list(orgId, token),
    [],
  );

  const { data: rooms, loading: roomsLoading } = useApi(
    (token, orgId) => api.rooms.list(orgId, token),
    [],
  );

  const { data: surveys, loading: surveysLoading } = useApi(
    (token, orgId) => api.impact.listSurveys(orgId, token),
    [],
  );

  const loading = membersLoading || eventsLoading || roomsLoading || surveysLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const totalMembers = membersData?.meta?.total ?? 0;
  const upcomingEvents = eventsData?.data?.filter(
    (e) => e.isPublished && new Date(e.startTime) > new Date(),
  ).length ?? 0;
  const totalRooms = rooms?.length ?? 0;
  const totalSurveyResponses = surveys?.reduce(
    (sum, s) => sum + (s._count?.responses ?? 0),
    0,
  ) ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome back, {user?.name || 'Admin'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Members"
          value={totalMembers}
          changeType="neutral"
          icon={Users}
        />
        <StatCard
          label="Upcoming Events"
          value={upcomingEvents}
          changeType="neutral"
          icon={Calendar}
        />
        <StatCard
          label="Rooms"
          value={totalRooms}
          changeType="neutral"
          icon={DoorOpen}
        />
        <StatCard
          label="Survey Responses"
          value={totalSurveyResponses}
          changeType="neutral"
          icon={BarChart3}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Activity - static placeholder until audit log API is available */}
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
            <span className="text-xs text-gray-400">Last 24 hours</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {recentActivity.map((item) => (
              <li key={item.id} className="flex items-start justify-between py-3">
                <p className="text-sm text-gray-700">{item.text}</p>
                <span className="ml-4 shrink-0 text-xs text-gray-400">{item.time}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
          <div className="space-y-3">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <div className="flex items-center gap-3">
                  <action.icon className="h-5 w-5 text-brand-600" />
                  <span className="text-sm font-medium text-gray-900">{action.label}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
