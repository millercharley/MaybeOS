'use client';

import { useParams } from 'next/navigation';

import Link from 'next/link';
import { Users, Calendar, DoorOpen, BarChart3, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { CountUp } from '@/components/ui/count-up';
import { deltaLabel } from '@/lib/count-up';
import { HappeningNow } from '@/components/live/happening-now';
import { PageHeader } from '@/components/layout/page-header';

// "New Survey" used to sit here pointing at /admin/impact. It never created a
// survey — the page it led to had no authoring UI, and authoring is a non-goal
// under D-021. Removed with the Impact page itself.
// Takes the slug, because every address names its co-op now.
const quickActionsFor = (orgSlug: string) => [
  { label: 'Create Event', href: `/admin/${orgSlug}/events`, icon: Calendar },
  { label: 'Add Member', href: `/admin/${orgSlug}/members`, icon: Users },
];

export default function AdminDashboardPage() {
  const orgSlug = useParams()?.orgSlug as string;
  const orgId = useAuthStore((s) => s.currentOrgId);
  const user = useAuthStore((s) => s.user);

  const { data: memberStats } = useApi(
    (token, orgId) => api.dashboard.memberStats(orgId, token),
  );
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

  // The stats endpoint is the authority; the paged list is the fallback
  // while it loads, so the number does not flash zero on the way in.
  const totalMembers = memberStats?.total ?? membersData?.meta?.total ?? 0;
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
        <PageHeader
          title="Dashboard"
          description={`Welcome back, ${user?.name || 'Admin'}`}
        />
      </div>

      {/* Above the counters, because "is anyone here right now" is a
          different kind of question from "how many members are there" — and
          it is the one somebody has while still standing up. Renders nothing
          when nothing is happening. */}
      {orgId && orgSlug && <HappeningNow orgId={orgId} orgSlug={orgSlug} />}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Members"
          value={<CountUp value={totalMembers} />}
          change={deltaLabel(memberStats?.joinedThisMonth ?? 0) ?? undefined}
          changeType="positive"
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

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="space-y-3">
          {quickActionsFor(orgSlug).map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50 gap-3"
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
  );
}
