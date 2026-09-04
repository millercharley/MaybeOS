'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListChecks, Loader2, Plus, Trash2 } from 'lucide-react';
import { api, OnboardingConfig, OnboardingStep, OnboardingStepKind } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * A co-op writing its own getting-started checklist (ONB-01).
 *
 * The switch seeds five usable steps the first time it is turned on, so an
 * admin who changes nothing still gets something that works — and everything
 * on this screen is about changing the *words*, because a housing co-op and a
 * maker space ask for the same things in very different ones.
 *
 * `kind` is the only field that is not cosmetic, and it is explained in those
 * terms: it decides how MaybeOS knows the step is done. Everything but
 * "Something else" ticks itself when the member actually does the thing, which
 * is why the destination is fixed for those and editable only for a custom
 * one. An admin choosing between them is choosing between "the product will
 * watch for this" and "the member tells us".
 */
const KINDS: Array<{ value: OnboardingStepKind; label: string; detects: string }> = [
  { value: 'PROFILE', label: 'Complete a profile', detects: 'Ticks when they have a name and a headline or bio.' },
  { value: 'HANDBOOK', label: 'Read the handbook', detects: 'Ticks when they acknowledge a handbook article.' },
  { value: 'COMMONS_POST', label: 'Post in the Commons', detects: 'Ticks on their first post or comment.' },
  { value: 'EVENT_RSVP', label: 'RSVP to an event', detects: 'Ticks on their first RSVP that is not cancelled.' },
  { value: 'ROOM_BOOKING', label: 'Book a room', detects: 'Ticks on their first booking.' },
  { value: 'SERVICE_CLAIM', label: 'Take a turn at something', detects: 'Ticks when they claim a duty and keep it.' },
  { value: 'CUSTOM', label: 'Something else', detects: 'The member marks this one done themselves.' },
];

export function GettingStartedSettings() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setConfig(await api.onboarding.config(orgId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="card flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </section>
    );
  }
  if (!config) return null;

  const steps = [...config.steps].sort((a, b) => a.position - b.position);

  function move(stepId: string, direction: -1 | 1) {
    const ids = steps.map((s) => s.id);
    const index = ids.indexOf(stepId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => api.onboarding.reorderSteps(orgId!, ids, token!));
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Getting started checklist</h2>
            <p className="mt-1 max-w-prose text-sm text-gray-500">
              A short list in every member&rsquo;s sidebar, showing one step at a time. Most
              steps tick themselves when the member actually does the thing — nobody has to
              claim they read the handbook.
            </p>
          </div>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={busy}
            onChange={(e) => run(() => api.onboarding.setEnabled(orgId!, e.target.checked, token!))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="font-medium text-gray-700">{config.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {!config.enabled && steps.length === 0 && (
        <p className="text-sm text-gray-500">
          Switching this on writes five starter steps you can then rewrite, reorder or delete.
        </p>
      )}

      {steps.length > 0 && (
        <ul className="space-y-3">
          {steps.map((step, index) => (
            <StepEditor
              key={step.id}
              step={step}
              busy={busy}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              onMove={(direction) => move(step.id, direction)}
              onSave={(data) => run(() => api.onboarding.updateStep(orgId!, step.id, data, token!))}
              onDelete={() =>
                run(async () => {
                  if (!window.confirm(`Remove "${step.title}" from the checklist?`)) return;
                  await api.onboarding.deleteStep(orgId!, step.id, token!);
                })
              }
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(() =>
            api.onboarding.createStep(
              orgId!,
              { title: 'A new step', kind: 'CUSTOM', ctaLabel: 'Do it now' },
              token!,
            ),
          )
        }
        className="btn-secondary inline-flex items-center gap-2 text-sm"
      >
        <Plus className="h-4 w-4" />
        Add a step
      </button>
    </section>
  );
}

/**
 * One row of the checklist, edited in place.
 *
 * Fields hold a local draft and the row saves on an explicit button, which
 * appears only once something has actually changed. The first version saved on
 * blur, and blur is the wrong moment for this: it does nothing when somebody
 * presses Enter, nothing when they navigate away mid-edit, and says nothing
 * either way — so the only feedback that the words were kept is going and
 * looking. A button that shows up when there is something to save, and goes
 * away when there is not, is both the prompt and the receipt.
 *
 * `kind` is exempt and saves immediately. It is a select rather than typing,
 * so there is no half-finished state to protect, and it changes what the rest
 * of the row means — the destination field appears and disappears with it.
 */
function StepEditor({
  step, busy, isFirst, isLast, onMove, onSave, onDelete,
}: {
  step: OnboardingStep;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (data: Partial<OnboardingStep>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
    title: step.title,
    description: step.description ?? '',
    ctaLabel: step.ctaLabel,
    href: step.href ?? '',
  });

  // A save elsewhere on the page reloads the whole config; without this, a
  // field somebody has not touched would keep the value it was mounted with.
  useEffect(() => {
    setDraft({
      title: step.title,
      description: step.description ?? '',
      ctaLabel: step.ctaLabel,
      href: step.href ?? '',
    });
  }, [step.title, step.description, step.ctaLabel, step.href]);

  const dirty =
    draft.title !== step.title ||
    draft.description !== (step.description ?? '') ||
    draft.ctaLabel !== step.ctaLabel ||
    draft.href !== (step.href ?? '');

  const kind = KINDS.find((k) => k.value === step.kind);
  const isCustom = step.kind === 'CUSTOM';

  function save() {
    if (!draft.title.trim() || !draft.ctaLabel.trim()) return;
    onSave({
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      ctaLabel: draft.ctaLabel.trim(),
      href: draft.href.trim() || null,
    });
  }

  return (
    <li className="rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="input min-w-0 flex-1 font-medium"
          aria-label="Step title"
        />
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => onMove(-1)} disabled={busy || isFirst}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40">Up</button>
          <button type="button" onClick={() => onMove(1)} disabled={busy || isLast}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40">Down</button>
          <button type="button" onClick={onDelete} disabled={busy}
            className="text-gray-400 hover:text-red-600 disabled:opacity-40" aria-label={`Remove ${step.title}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        rows={2}
        placeholder="Shown only while this is the member's current step."
        className="input mt-2 w-full text-sm"
        aria-label="Step description"
      />

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-500">
          How it ticks
          <select
            value={step.kind}
            disabled={busy}
            onChange={(e) => onSave({ kind: e.target.value as OnboardingStepKind })}
            className="input mt-1 w-full text-sm"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-500">
          Button label
          <input
            value={draft.ctaLabel}
            onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="input mt-1 w-full text-sm"
            aria-label="Button label"
          />
        </label>
      </div>

      {isCustom ? (
        <label className="mt-2 block text-xs text-gray-500">
          Where the button goes
          <input
            value={draft.href}
            onChange={(e) => setDraft({ ...draft, href: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="/portal/your-coop/events"
            className="input mt-1 w-full text-sm"
            aria-label="Where the button goes"
          />
        </label>
      ) : (
        <p className="mt-2 text-xs text-gray-400">
          Goes to <span className="data">{step.resolvedHref}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {kind && <p className="min-w-0 flex-1 text-xs text-gray-500">{kind.detects}</p>}
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={busy || !draft.title.trim() || !draft.ctaLabel.trim()}
            className="btn-primary shrink-0 px-3 py-1 text-xs disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
    </li>
  );
}
