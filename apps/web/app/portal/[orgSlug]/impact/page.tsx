'use client';

import { useState } from 'react';
import { BarChart3, CheckCircle } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, Survey, SurveyQuestion } from '@/lib/api';

export default function PortalImpactPage() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSurvey, setActiveSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());

  useState(() => {
    if (!org || !token) { setLoading(false); return; }
    api.impact
      .listSurveys(org.id, token)
      .then(setSurveys)
      .catch(() => {})
      .finally(() => setLoading(false));
  });

  async function handleSubmit() {
    if (!org || !token || !activeSurvey) return;
    setSubmitting(true);
    try {
      await api.impact.submitResponse(org.id, activeSurvey.id, { answers }, token);
      setSubmitted((prev) => new Set(prev).add(activeSurvey.id));
      setActiveSurvey(null);
      setAnswers({});
    } catch {}
    setSubmitting(false);
  }

  if (!token) {
    return (
      <div className="py-12 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Surveys</h1>
        <p className="mt-2 text-sm text-gray-500">Sign in to participate in community surveys.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (activeSurvey) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <button onClick={() => setActiveSurvey(null)} className="text-sm text-brand-600 hover:text-brand-700">
            Back to surveys
          </button>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{activeSurvey.title}</h1>
          {activeSurvey.description && (
            <p className="mt-1 text-sm text-gray-500">{activeSurvey.description}</p>
          )}
        </div>

        <div className="space-y-6">
          {(activeSurvey.questions || []).map((q: SurveyQuestion, i: number) => (
            <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-5">
              <label className="block text-sm font-medium text-gray-900">
                {i + 1}. {q.text}
                {q.required && <span className="ml-1 text-red-500">*</span>}
              </label>

              {q.type === 'SCALE' && (
                <div className="mt-3 flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: String(n) }))}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                        answers[q.id] === String(n)
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'CHOICE' && q.options && (
                <div className="mt-3 space-y-2">
                  {q.options.map((opt) => (
                    <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={answers[q.id] === opt}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                        className="text-brand-600"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}

              {(q.type === 'TEXT' || q.type === 'OPEN_ENDED') && (
                <textarea
                  className="input mt-3 w-full"
                  rows={3}
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Your answer..."
                />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary w-full"
        >
          {submitting ? 'Submitting...' : 'Submit Survey'}
        </button>
      </div>
    );
  }

  const activeSurveys = surveys.filter((s) => s.isActive);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Surveys</h1>

      {activeSurveys.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No active surveys right now.</p>
      ) : (
        <div className="space-y-4">
          {activeSurveys.map((survey) => (
            <div
              key={survey.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5"
            >
              <div>
                <h3 className="text-base font-semibold text-gray-900">{survey.title}</h3>
                {survey.description && (
                  <p className="mt-1 text-sm text-gray-500">{survey.description}</p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  {survey.questions?.length || 0} questions
                </p>
              </div>
              {submitted.has(survey.id) ? (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
                  <CheckCircle className="h-4 w-4" /> Submitted
                </span>
              ) : (
                <button
                  onClick={() => { setActiveSurvey(survey); setAnswers({}); }}
                  className="btn-primary text-sm"
                >
                  Take Survey
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
