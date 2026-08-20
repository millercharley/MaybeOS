'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Loader2, Pause, Target } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import Link from 'next/link';
import { api, MeasurementStatus, SignalsByGoal } from '@/lib/api';
import { SignalsView, CATEGORY_LABEL } from '@/components/impact/signals';

const TOUCHPOINT_LABEL: Record<string, string> = {
  TICKET_PURCHASE: 'After buying a ticket',
  BOOKING: 'After booking a room',
  POST_EVENT: 'After an event',
  COMMONS: 'In the Commons',
};

/**
 * Turning measurement on, having read what will be asked (IMP-18).
 *
 * Deliberately the whole of this page, and deliberately not a dashboard. The
 * Signals view that reports what a co-op learned is IMP-20; this is the
 * control that has to exist before there is anything to report, because
 * production held zero questions and therefore zero answers.
 *
 * **The questions are shown before the switch, not after.** An organiser
 * turning this on is about to have MaybeOS put questions to their members;
 * nobody should discover what their co-op is asking by being asked it. That
 * is also why nothing installs automatically — signing up for MaybeOS is not
 * consent to survey your own membership.
 */
export default function AdminImpactPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [status, setStatus] = useState<MeasurementStatus | null>(null);
  const [signals, setSignals] = useState<SignalsByGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const [measurement, learned] = await Promise.all([
        api.impact.measurement(orgId, token),
        api.impact.signalsByGoal(orgId, token),
      ]);
      setStatus(measurement);
      setSignals(learned);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the measurement plan');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (!token || !orgId || !status) return;
    setBusy(true);
    setError('');
    try {
      if (status.collecting) await api.impact.stopMeasuring(orgId, token);
      else await api.impact.startMeasuring(orgId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not take effect');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const byTouchpoint = Object.keys(TOUCHPOINT_LABEL).map((tp) => ({
    touchpoint: tp,
    questions: (status?.questions ?? []).filter((q) => q.touchpoint === tp),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Measuring impact</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          MaybeOS asks your members one short question at a time, at moments they are already
          in — never more than one per member per month. Over a year that is about twelve
          questions each, which is what a report is made of.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-medium text-gray-900">
              <Activity className={`h-4 w-4 ${status?.collecting ? 'text-green-600' : 'text-gray-400'}`} />
              {status?.collecting ? 'Collecting' : 'Not collecting'}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {status?.collecting ? (
                <>
                  {status.window ? `${status.window.label} · ` : ''}
                  {status.responseCount} {status.responseCount === 1 ? 'member has' : 'members have'}{' '}
                  answered, {status.answerCount} {status.answerCount === 1 ? 'answer' : 'answers'} so far.
                </>
              ) : status?.installed ? (
                'Paused. Every answer already given is kept and still counts.'
              ) : (
                'Nothing has been asked yet.'
              )}
            </p>
          </div>

          <button onClick={toggle} disabled={busy} className={status?.collecting ? 'btn-secondary' : 'btn-primary'}>
            {busy ? (
              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
            ) : status?.collecting ? (
              <Pause className="mr-1.5 inline h-4 w-4" />
            ) : (
              <Check className="mr-1.5 inline h-4 w-4" />
            )}
            {status?.collecting ? 'Pause' : 'Start measuring'}
          </button>
        </div>

        {/* The thing to read before deciding. */}
        {!status?.collecting && (
          <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            Read these first — they are what your members will be shown. Nothing is asked until
            you start, and pausing keeps everything already collected.
          </p>
        )}
      </section>

      {/* The plan first, because a figure with no stated intention behind it
          is a statistic — the same figure under a goal is a finding. */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Target className="h-4 w-4 text-gray-400" />
              What you&apos;re trying to do
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {signals && signals.goals.length > 0
                ? `${signals.goals.length} ${signals.goals.length === 1 ? 'goal' : 'goals'}, and what measures each.`
                : 'No goals yet, so nothing collected can be connected to what your co-op is for.'}
            </p>
          </div>
          <Link href="impact/plan" className="btn-secondary text-sm">
            {signals && signals.goals.length > 0 ? 'Edit the plan' : 'Write your plan'}
          </Link>
        </div>

        {signals && signals.goals.length > 0 && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            {signals.goals.map((goal) => (
              <div key={goal.goalId}>
                <h3 className="text-sm font-medium text-gray-900">{goal.title}</h3>
                {goal.unmeasured ? (
                  <p className="mt-0.5 text-sm text-amber-700">
                    Nothing measures this yet, so it will never produce a figure.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {goal.measures.map((m) => (
                      <li key={m.indicatorId} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-gray-600">{m.label}</span>
                        <span className="tabular-nums text-gray-900">
                          {m.signal?.average != null ? (
                            <>
                              {m.signal.average.toFixed(1)}
                              <span className="text-gray-400"> / 5</span>
                            </>
                          ) : m.signal ? (
                            // Too few people, which is not the same as nobody
                            // having been asked — and reads differently.
                            <span className="text-gray-400">
                              {m.signal.respondents} of {signals.suppressionThreshold} answered
                            </span>
                          ) : (
                            <span className="text-gray-400">not asked yet</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {signals.unclaimed.length > 0 && (
              <p className="border-t border-gray-100 pt-3 text-xs text-gray-500">
                {/* Often a goal somebody forgot to write down rather than noise. */}
                Also being collected, under no goal:{' '}
                {signals.unclaimed.map((c) => CATEGORY_LABEL[c.category] ?? c.category).join(', ')}.
              </p>
            )}
          </div>
        )}
      </section>

      {/* What came back, above what is being asked: an organiser opening this
          page once collection is running wants the answers, not the
          questionnaire. Before there is anything, the questions are the
          page. */}
      {signals && signals.categories.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">What your members told you</h2>
          <SignalsView signals={signals} />
          <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            Totals only. Individual answers are never shown to organisers, including yours.
          </p>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">
          {signals && signals.categories.length > 0 ? 'What is being asked' : 'The questions'}
        </h2>
        {byTouchpoint.map(({ touchpoint, questions }) => (
          <div key={touchpoint} className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">{TOUCHPOINT_LABEL[touchpoint]}</h2>
            <ul className="mt-3 space-y-3">
              {questions.map((q) => (
                <li key={q.key} className="text-sm">
                  <p className="text-gray-900">{q.text}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {q.anchorLow && q.anchorHigh ? `${q.anchorLow} → ${q.anchorHigh}` : q.type}
                    {q.category && ` · ${q.category.replace(/_/g, ' ')}`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="max-w-2xl text-xs text-gray-400">
        {/* Said plainly because it is the constraint everything rests on, and
            because an admin who expects a survey builder should learn here
            that this is not one. */}
        These questions ship with MaybeOS and are the same for every co-op, so results can be
        read the same way everywhere. Questions written for your own goals come later, with the
        measurement plan. Individual answers are never shown to organisers — only totals, and
        only where enough people answered to keep anyone from being identifiable.
      </p>
    </div>
  );
}
