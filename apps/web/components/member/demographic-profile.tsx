'use client';

import { useEffect, useState } from 'react';
import { Info, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, MyDemographics } from '@/lib/api';

/**
 * The demographic profile (IMP-17, PRD §6.4 and §10).
 *
 * Collected once, here, and never inside an impact micro-survey — asking the
 * same personal questions on every response would burn the fatigue budget and
 * scatter copies of the answers across every survey a member ever completes.
 *
 * Three rules from the PRD are load-bearing rather than decorative, so they
 * are visible in the interface rather than buried in a policy:
 *
 *   - Every field is optional and skippable *on its own*. There is no submit
 *     gate and no required marker anywhere on this form.
 *   - Every field offers "prefer not to say" as a real answer. Choosing it is
 *     not the same as leaving a field blank, and the reports count them apart.
 *   - The member can delete the whole profile at any time, and deletion
 *     reaches future reports.
 *
 * The framing sentence is the PRD's own wording. It is the honest reason to
 * ask, and a member who reads it can decide knowing what it is for.
 */

/** Turns `35_44` into `35–44`, and `prefer_not_to_say` into prose. */
function humanise(value: string): string {
  if (value === 'prefer_not_to_say') return 'Prefer not to say';
  const spaced = value.replace(/_/g, ' ');
  const withRanges = spaced
    .replace(/^(\d+) (\d+)$/, '$1–$2')
    .replace(/^under (\d+)k?$/i, 'Under $1')
    .replace(/^over (\d+)k?$/i, 'Over $1')
    .replace(/(\d+)k (\d+)k/, '$$$1k–$$$2k')
    .replace(/^(\d+) plus$/, '$1+');
  return withRanges.charAt(0).toUpperCase() + withRanges.slice(1);
}

export function DemographicProfile() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [data, setData] = useState<MyDemographics | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!token || !orgId) return;
    api.impact
      .myDemographics(orgId, token)
      .then((d) => {
        setData(d);
        setAnswers(d.answers);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, orgId]);

  async function save() {
    if (!token || !orgId) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await api.impact.saveMyDemographics(orgId, answers, token);
      setAnswers(result.answers);
      setMessage('Saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    if (!token || !orgId) return;
    setSaving(true);
    try {
      await api.impact.deleteMyDemographics(orgId, token);
      setAnswers({});
      setConfirmingDelete(false);
      setMessage('Deleted. This won&rsquo;t appear in future reports.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) return null;

  const answered = Object.keys(answers).length;

  return (
    <section className="card">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        About you
      </h2>

      <p className="mt-2 flex gap-2 rounded-lg bg-[var(--surface-sunken)] p-3 text-sm text-[var(--text-secondary)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        <span>
          This helps us show who the space actually serves — and who it
          doesn&apos;t reach yet. Every question is optional, and answers are
          only ever reported in groups of {data.suppressionThreshold} or more,
          never on their own.
        </span>
      </p>

      {message && (
        <div
          className={`mt-3 rounded-lg p-3 text-sm ${
            message.startsWith('Saved') || message.startsWith('Deleted')
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {data.fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`demo-${field.key}`}
              className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
            >
              {field.label}
            </label>

            {field.options ? (
              <select
                id={`demo-${field.key}`}
                value={answers[field.key] ?? ''}
                onChange={(e) =>
                  setAnswers((prev) => {
                    const next = { ...prev };
                    // Removing the key rather than storing '' keeps "skipped"
                    // distinct from "prefer not to say" all the way down.
                    if (e.target.value) next[field.key] = e.target.value;
                    else delete next[field.key];
                    return next;
                  })
                }
                className="input w-full"
              >
                <option value="">Skip this one</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {humanise(option)}
                  </option>
                ))}
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            ) : (
              <input
                id={`demo-${field.key}`}
                type="text"
                value={
                  answers[field.key] === 'prefer_not_to_say'
                    ? ''
                    : (answers[field.key] ?? '')
                }
                maxLength={120}
                placeholder="Optional"
                onChange={(e) =>
                  setAnswers((prev) => {
                    const next = { ...prev };
                    if (e.target.value) next[field.key] = e.target.value;
                    else delete next[field.key];
                    return next;
                  })
                }
                className="input w-full"
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        {answered > 0 ? (
          confirmingDelete ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-[var(--text-secondary)]">Delete all of it?</span>
              <button
                type="button"
                onClick={deleteAll}
                className="font-semibold text-red-600 hover:underline"
                disabled={saving}
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-[var(--text-secondary)] hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
              Delete this
            </button>
          )
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">
            Nothing saved yet.
          </span>
        )}

        <button
          type="button"
          onClick={save}
          className="btn-primary text-sm"
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </section>
  );
}
