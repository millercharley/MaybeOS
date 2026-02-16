'use client';

import { Plus, BarChart3, Heart, TrendingUp, Users } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

interface Survey {
  id: string;
  title: string;
  type: 'BELONGING' | 'SATISFACTION' | 'FEEDBACK' | 'CUSTOM';
  responseCount: number;
  totalMembers: number;
  status: 'ACTIVE' | 'COMPLETED' | 'DRAFT';
}

const surveys: Survey[] = [
  {
    id: '1',
    title: 'Q1 2026 Belonging Survey',
    type: 'BELONGING',
    responseCount: 94,
    totalMembers: 128,
    status: 'ACTIVE',
  },
  {
    id: '2',
    title: 'New Member Onboarding Feedback',
    type: 'FEEDBACK',
    responseCount: 18,
    totalMembers: 22,
    status: 'ACTIVE',
  },
  {
    id: '3',
    title: 'Q4 2025 Belonging Survey',
    type: 'BELONGING',
    responseCount: 112,
    totalMembers: 120,
    status: 'COMPLETED',
  },
  {
    id: '4',
    title: 'Facilities Satisfaction Survey',
    type: 'SATISFACTION',
    responseCount: 87,
    totalMembers: 128,
    status: 'COMPLETED',
  },
  {
    id: '5',
    title: 'Annual Community Impact Assessment',
    type: 'CUSTOM',
    responseCount: 0,
    totalMembers: 128,
    status: 'DRAFT',
  },
];

const typeBadge: Record<Survey['type'], string> = {
  BELONGING: 'bg-purple-50 text-purple-700',
  SATISFACTION: 'bg-blue-50 text-blue-700',
  FEEDBACK: 'bg-green-50 text-green-700',
  CUSTOM: 'bg-gray-100 text-gray-600',
};

const statusBadge: Record<Survey['status'], string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  DRAFT: 'bg-yellow-50 text-yellow-700',
};

const chartDataPoints = [
  { month: 'Sep 2025', score: 3.8 },
  { month: 'Oct 2025', score: 3.9 },
  { month: 'Nov 2025', score: 4.0 },
  { month: 'Dec 2025', score: 4.0 },
  { month: 'Jan 2026', score: 4.1 },
  { month: 'Feb 2026', score: 4.2 },
];

export default function ImpactPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Impact Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Survey Responses"
          value={342}
          change="+28 this week"
          changeType="positive"
          icon={BarChart3}
        />
        <StatCard
          label="Avg Belonging Score"
          value="4.2 / 5"
          change="+0.2 from last quarter"
          changeType="positive"
          icon={Heart}
        />
        <StatCard
          label="Network Growth"
          value="+18%"
          change="vs. previous quarter"
          changeType="positive"
          icon={TrendingUp}
        />
        <StatCard
          label="Participation Rate"
          value="73%"
          change="+5% from last survey"
          changeType="positive"
          icon={Users}
        />
      </div>

      {/* Belonging Score Trend chart placeholder */}
      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Belonging Score Trend</h2>
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8">
          <p className="mb-4 text-center text-sm font-medium text-gray-500">
            Chart: Belonging score over time
          </p>
          <div className="flex items-end justify-center gap-4">
            {chartDataPoints.map((point) => (
              <div key={point.month} className="flex flex-col items-center gap-2">
                <span className="text-xs font-semibold text-brand-600">{point.score}</span>
                <div
                  className="w-12 rounded-t-md bg-brand-500"
                  style={{ height: `${(point.score / 5) * 120}px` }}
                />
                <span className="text-xs text-gray-400 whitespace-nowrap">{point.month}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Surveys */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Active Surveys</h2>
          <button className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Survey
          </button>
        </div>

        <div className="space-y-3">
          {surveys.map((survey) => {
            const responsePercent =
              survey.totalMembers > 0
                ? Math.round((survey.responseCount / survey.totalMembers) * 100)
                : 0;

            return (
              <div
                key={survey.id}
                className="card flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{survey.title}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge[survey.type]}`}
                      >
                        {survey.type}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[survey.status]}`}
                      >
                        {survey.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {survey.responseCount} / {survey.totalMembers}
                    </p>
                    <p className="text-xs text-gray-500">responses</p>
                  </div>
                  <div className="w-32">
                    <div className="h-2 rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${responsePercent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-xs text-gray-400">{responsePercent}%</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
