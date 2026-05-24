'use client';

import { Plus, BarChart3, Heart, TrendingUp, Users } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

const typeBadge: Record<string, string> = {
  BELONGING: 'bg-purple-50 text-purple-700',
  SATISFACTION: 'bg-blue-50 text-blue-700',
  FEEDBACK: 'bg-green-50 text-green-700',
  CUSTOM: 'bg-gray-100 text-gray-600',
};

const statusBadge: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  DRAFT: 'bg-yellow-50 text-yellow-700',
};

export default function ImpactPage() {
  const { data: dashboard, loading: dashboardLoading, error: dashboardError } = useApi(
    (token, orgId) => api.impact.dashboard(orgId, token),
    [],
  );

  const { data: surveys, loading: surveysLoading, error: surveysError } = useApi(
    (token, orgId) => api.impact.listSurveys(orgId, token),
    [],
  );

  const loading = dashboardLoading || surveysLoading;
  const error = dashboardError || surveysError;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Failed to load impact data: {error}
      </div>
    );
  }

  const surveyList = surveys ?? [];
  const totalMembers = dashboard?.totalMembers ?? 0;
  const totalSurveyResponses = surveyList.reduce(
    (sum, s) => sum + (s._count?.responses ?? 0),
    0,
  );
  const avgBelonging = dashboard?.surveyMetrics?.belonging;
  const participationRate = totalMembers > 0
    ? Math.round((totalSurveyResponses / totalMembers) * 100)
    : 0;

  const chartDataPoints = dashboard?.trends ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Impact Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Members"
          value={dashboard?.totalMembers ?? 0}
          changeType="neutral"
          icon={Users}
        />
        <StatCard
          label="Total Events"
          value={dashboard?.totalEvents ?? 0}
          changeType="neutral"
          icon={BarChart3}
        />
        <StatCard
          label="Avg Attendance"
          value={dashboard?.avgAttendance ?? 0}
          changeType="neutral"
          icon={Heart}
        />
        <StatCard
          label="Participation Rate"
          value={`${participationRate}%`}
          changeType="neutral"
          icon={TrendingUp}
        />
      </div>

      {/* Belonging Score Trend chart */}
      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Belonging Score Trend</h2>
        {chartDataPoints.length > 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8">
            <p className="mb-4 text-center text-sm font-medium text-gray-500">
              Chart: Belonging score over time
            </p>
            <div className="flex items-end justify-center gap-4">
              {chartDataPoints.map((point) => (
                <div key={point.month} className="flex flex-col items-center gap-2">
                  <span className="text-xs font-semibold text-brand-600">{point.belonging.toFixed(1)}</span>
                  <div
                    className="w-12 rounded-t-md bg-brand-500"
                    style={{ height: `${(point.belonging / 5) * 120}px` }}
                  />
                  <span className="text-xs text-gray-400 whitespace-nowrap">{point.month}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8">
            <p className="text-center text-sm text-gray-500">
              No trend data available yet.
            </p>
          </div>
        )}
      </div>

      {/* Active Surveys */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Surveys</h2>
          <button className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Survey
          </button>
        </div>

        <div className="space-y-3">
          {surveyList.map((survey) => {
            const responseCount = survey._count?.responses ?? 0;
            const responsePercent =
              totalMembers > 0
                ? Math.round((responseCount / totalMembers) * 100)
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
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge[survey.type.toUpperCase()] ?? typeBadge.CUSTOM}`}
                      >
                        {survey.type}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${survey.isActive ? statusBadge.ACTIVE : statusBadge.COMPLETED}`}
                      >
                        {survey.isActive ? 'ACTIVE' : 'COMPLETED'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {responseCount} / {totalMembers}
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

          {surveyList.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-500">
              No surveys found. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
