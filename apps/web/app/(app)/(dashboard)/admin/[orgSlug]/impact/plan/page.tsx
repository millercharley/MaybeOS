'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, MeasurementPlan, DraftedIndicator } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

/**
 * What the co-op is trying to do, and how it will know (IMP-21, PRD §5).
 *
 * The mission and three to five goals in plain language, each with the things
 * that measure it, and an approval at the end. This is the spine everything
 * else hangs from: before it, ImpactOS could report a belonging score and
 * never say why the co-op cared about belonging.
 *
 * **The drafting here is not the AI the PRD describes.** MaybeOS has no LLM
 * client, no key, and no decision about what a co-op's mission may be sent to
 * — which is a decision to take deliberately rather than by adding a
 * dependency. So suggestions are matched from what MaybeOS already asks, each
 * showing *why* it was suggested so an organiser judges it rather than defers
 * to it. Everything downstream is the same either way, because the drafter's
 * only job is to propose.
 */
export default function MeasurementPlanPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [plan, setPlan] = useState<MeasurementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [mission, setMission] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [suggested, setSuggested] = useState<Record<string, DraftedIndicator[]>>({});

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      const next = await api.impact.plan(orgId, token);
      setPlan(next);
      setMission(next.mission ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the plan');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not take effect');
    } finally {
      setBusy(false);
    }
  };

  async function addGoal() {
    if (!newGoal.trim() || !token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      const { goal, suggested: proposals } = await api.impact.createGoal(
        orgId,
        { title: newGoal.trim() },
        token,
      );
      // Held beside the goal rather than applied to it: a plan populated on
      // an organiser's behalf is a plan nobody has read.
      setSuggested((s) => ({ ...s, [goal.id]: proposals }));
      setNewGoal('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that goal');
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

  const approved = plan?.status === 'APPROVED';
  const atLimit = (plan?.goals.length ?? 0) >= (plan?.maxGoals ?? 5);

  return (
    <div className="space-y-6">
      <Link
        href="../impact"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Measuring
      </Link>

      <div>
        <PageHeader
          title="Your measurement plan"
          description="What your co-op is trying to do, and how you&apos;ll know whether it&apos;s working."
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>
      )}

      {/* Status first, because "approved" and "edited since approval" are the
          two states an organiser actually needs to tell apart. */}
      <div
        className={`rounded-xl border p-4 ${
          approved ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
        }`}
      >
        <p className={`text-sm font-medium ${approved ? 'text-green-900' : 'text-amber-900'}`}>
          {approved ? 'Plan agreed' : 'Draft — not yet agreed'}
        </p>
        <p className={`mt-0.5 text-sm ${approved ? 'text-green-800' : 'text-amber-800'}`}>
          {approved && plan?.approvedAt
            ? `Agreed ${new Date(plan.approvedAt).toLocaleDateString()}. Any change here returns it to draft.`
            : 'Write a mission, add your goals, and say what measures each one.'}
        </p>
        {!approved && (
          <button
            onClick={() => run(() => api.impact.approvePlan(orgId!, token!))}
            disabled={busy}
            className="btn-primary mt-3 text-sm"
          >
            <Check className="mr-1.5 inline h-4 w-4" />
            Agree to this plan
          </button>
        )}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Mission</h2>
        <textarea
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          onBlur={() => mission !== (plan?.mission ?? '') && run(() => api.impact.setMission(orgId!, mission, token!))}
          rows={2}
          maxLength={500}
          placeholder="A city where nobody has to face a hard week alone."
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Goals <span className="font-normal text-gray-400">({plan?.goals.length ?? 0} of {plan?.maxGoals})</span>
          </h2>
        </div>

        {plan?.goals.map((goal) => (
          <div key={goal.id} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-gray-900">{goal.title}</h3>
                {goal.description && <p className="mt-0.5 text-sm text-gray-500">{goal.description}</p>}
              </div>
              <button
                onClick={() => run(() => api.impact.archiveGoal(orgId!, goal.id, token!))}
                disabled={busy}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                aria-label={`Archive ${goal.title}`}
                title="Archive — kept in your record, not deleted"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500">Measured by</p>

              {goal.indicators.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5">
                  {goal.indicators.map((ind) => (
                    <li key={ind.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-gray-900">{ind.label}</span>
                      <button
                        onClick={() => run(() => api.impact.removeIndicator(orgId!, goal.id, ind.id, token!))}
                        disabled={busy}
                        className="shrink-0 rounded p-0.5 text-gray-400 hover:text-red-600"
                        aria-label={`Remove ${ind.label}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                // Said plainly: a goal with nothing measuring it produces no
                // figure ever, and will read in a report as a goal the co-op
                // failed at rather than one it never measured.
                <p className="mt-1.5 text-sm text-amber-700">
                  Nothing measures this yet, so it will never produce a figure.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(suggested[goal.id] ?? plan.available)
                  .filter((option) => !goal.indicators.some((i) => i.category === option.category))
                  .map((option) => (
                    <button
                      key={option.category}
                      onClick={() =>
                        run(() =>
                          api.impact.addIndicator(
                            orgId!,
                            goal.id,
                            { category: option.category, label: option.label },
                            token!,
                          ),
                        )
                      }
                      disabled={busy}
                      // The question wording on hover, because what is
                      // actually asked is what the organiser is agreeing to.
                      title={option.questions.join('\n')}
                      className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
                    >
                      <Plus className="mr-1 inline h-3 w-3" />
                      {option.label}
                      {suggested[goal.id] && (
                        <span className="ml-1 text-gray-400">· {option.because}</span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}

        {!atLimit && (
          <div className="rounded-xl border border-dashed border-gray-300 p-4">
            <div className="flex gap-2">
              <input
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGoal()}
                maxLength={120}
                placeholder="People who come here make friends they keep"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button onClick={addGoal} disabled={busy || !newGoal.trim()} className="btn-secondary text-sm">
                Add goal
              </button>
            </div>
          </div>
        )}

        {atLimit && (
          <p className="text-xs text-gray-500">
            {/* The ceiling is the discipline, so it says why rather than just
                refusing. */}
            Five is the limit. A co-op measuring nine things measures none of them — and there is
            only room to ask each member about a handful a year.
          </p>
        )}
      </section>
    </div>
  );
}
