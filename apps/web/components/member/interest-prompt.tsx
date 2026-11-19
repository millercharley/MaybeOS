'use client';

import { useState } from 'react';
import Link from 'next/link';
import { InterestAsk, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Panel } from '@/components/layout/panel';

/**
 * "Which of these interest you?" — the question Radar learns from (RDR-01).
 *
 * Three or four at a time, each one a single tap, because the alternative is
 * a settings page nobody opens. A member who answers once has told MaybeOS
 * enough to start matching; a member who answers every few weeks has told it
 * enough to be good at it.
 *
 * **It renders nothing far more often than it renders.** Radar off, the
 * co-op not on a plan that includes it, asked recently, waved away three
 * times, nothing left to ask about — all of those come back as no question,
 * and the dashboard simply does not grow a box. The API decides; this
 * component never second-guesses it, because the cadence is the promise.
 *
 * **Both answers are answers.** "Not for me" is recorded as a declared no,
 * not as silence: it is the only way a member can stop being told about
 * something, and a card with only a yes button would make that impossible.
 */
export function InterestPrompt({
  orgSlug,
  ask: offered,
}: {
  orgSlug: string;
  ask: InterestAsk | null;
}) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  /*
    The question is handed in with the dashboard's other panels (OPS-46)
    rather than fetched here.

    The "no question" cases are unchanged and there are many of them — Radar
    off, the co-op not on a plan that includes it, asked recently, waved away
    three times, nothing left to ask about. A section the bundle could not
    answer joins that list and reads as no question, which was already this
    component's own rule: a dashboard is not the place to report that a
    question could not be fetched, and no question is the same outcome as no
    answer.

    An empty `interests` array means the same as no ask, as it did before:
    `null`, so nothing draws.
  */
  const ask = offered?.interests?.length ? offered : null;

  if (!token || !orgId || !ask || done) return null;

  const pick = (tagId: string, declared: boolean) =>
    setAnswers((current) => ({ ...current, [tagId]: declared }));

  async function save() {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      await api.radar.setInterests(
        orgId,
        ask!.interests.map((interest) => ({
          tagId: interest.tagId,
          // Anything untouched stays unanswered rather than becoming a no:
          // not picking something is not the same as refusing it, and the
          // difference decides whether it is ever offered again.
          declared: answers[interest.tagId] ?? null,
        })),
        token,
      );
      setDone(true);
    } catch {
      setBusy(false);
    }
  }

  async function notNow() {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      await api.radar.dismissAsk(orgId, token);
    } finally {
      setDone(true);
    }
  }

  const answered = Object.keys(answers).length;

  return (
    <Panel title="What are you into?">
      <p className="text-sm text-[var(--text-secondary)]">
        Tap the ones you&rsquo;d want to hear about. We&rsquo;ll email you when something matching
        comes up — once a week at most.
      </p>

      <ul className="mt-4 space-y-2">
        {ask.interests.map((interest) => (
          <li key={interest.tagId} className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-primary)]">
              <span aria-hidden className="mr-2">
                {interest.emoji ?? '•'}
              </span>
              {interest.name}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                aria-pressed={answers[interest.tagId] === true}
                onClick={() => pick(interest.tagId, true)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  answers[interest.tagId] === true
                    ? 'border-transparent bg-[var(--text-primary)] text-[var(--surface)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                aria-pressed={answers[interest.tagId] === false}
                onClick={() => pick(interest.tagId, false)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  answers[interest.tagId] === false
                    ? 'border-transparent bg-[var(--surface-sunken)] font-medium'
                    : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Not for me
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={notNow} disabled={busy} className="text-sm text-[var(--text-tertiary)] hover:underline">
          Not now
        </button>
        <button type="button" onClick={save} disabled={busy || answered === 0} className="btn-primary">
          Save
        </button>
      </div>

      <p className="mt-3 text-xs text-[var(--text-tertiary)]">
        <Link href={`/member/${orgSlug}/settings#interests`} className="hover:underline">
          See everything you&rsquo;re interested in
        </Link>
      </p>
    </Panel>
  );
}
