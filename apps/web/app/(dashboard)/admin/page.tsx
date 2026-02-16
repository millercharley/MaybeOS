'use client';

import Link from 'next/link';
import { Users, Calendar, DoorOpen, BarChart3, ArrowRight } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { useAuthStore } from '@/lib/auth-store';

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
          value={128}
          change="+12 this month"
          changeType="positive"
          icon={Users}
        />
        <StatCard
          label="Upcoming Events"
          value={12}
          change="3 this week"
          changeType="neutral"
          icon={Calendar}
        />
        <StatCard
          label="Active Bookings"
          value={8}
          change="+2 today"
          changeType="positive"
          icon={DoorOpen}
        />
        <StatCard
          label="Survey Responses"
          value={342}
          change="+18% participation"
          changeType="positive"
          icon={BarChart3}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
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
