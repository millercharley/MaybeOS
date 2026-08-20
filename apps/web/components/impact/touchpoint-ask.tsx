'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, TouchpointAsk as Ask } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * One question, at a moment the member is already in (IMP-15, PRD §6.2).
 *
 * Not a survey and deliberately hard to grow into one: a single tap-select
 * question, no text box, no "next". The fatigue budget (D-021) is spent per
 * ask, so anything that asked two things would be a survey wearing a
 * micro-question's clothes.
 *
 * **Renders nothing far more often than it renders something.** One question
 * per member per 30 days across every touchpoint means the ordinary outcome
 * of a ticket purchase is silence. That is the feature, not a failure: D-021
 * calls response rate the binding constraint on the whole product, and a plan
 * that burns goodwill in month two has no report in month twelve.
 *
 * Dismissal is reported, never silently dropped — it widens that member's
 * window, and three dismissals move them to an annual check-in.
 */
export function TouchpointAsk({
  orgId,
  touchpoint,
}: {
  orgId: string;
  touchpoint: 'TICKET_PURCHASE' | 'BOOKING' | 'POST_EVENT' | 'COMMONS';
}) {
  const token = useAuthStore((s) => s.token);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Guests are never asked: the budget is per membership, so there is
    // nothing to spend and nobody to attribute an answer to.
    if (!token || !orgId) return;
    let live = true;
    api.impact
      .nextAsk(orgId, touchpoint, token)
      .then((res) => {
        if (live) setAsk(res?.question ?? null);
      })
      // Silent by design, and the one place that is right: this is a question
      // nobody asked for. An error banner about a survey the member never
      // requested, on the screen confirming their ticket, is worse than
      // showing nothing.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, touchpoint, token]);

  if (!ask || done) return null;

  async function answer(value: string | number) {
    if (!token || busy || !ask) return;
    setBusy(true);
    try {
      await api.impact.answerAsk(orgId, ask.id, value, token);
    } catch {
      // Their answer is lost, but telling them so on a confirmation screen
      // helps nobody — there is nothing for them to do about it.
    }
    setDone(true);
  }

  async function dismiss() {
    if (!token || busy) return;
    setBusy(true);
    try {
      await api.impact.dismissAsk(orgId, token);
    } catch {
      // Same reasoning. The window simply is not widened.
    }
    setDone(true);
  }

  const choices: (string | number)[] =
    ask.type === 'SCALE'
      ? [1, 2, 3, 4, 5]
      : // "How many people did you talk to?" is a count, and 5+ is an honest
        // ceiling for a one-tap answer — the difference between six and nine
        // new faces is not what any of this is measuring.
        ask.type === 'NUMBER'
        ? [0, 1, 2, 3, 4, 5]
        : ask.options.length
          ? ask.options
          : [];

  // A question with nothing to tap would be a dead end.
  if (choices.length === 0) return null;

  const scaled = ask.type === 'SCALE' || ask.type === 'NUMBER';

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">{ask.text}</p>
        <button
          onClick={dismiss}
          disabled={busy}
          aria-label="No thanks"
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Both ends named. A 1–5 with no labels is five buttons, and the
          answers only mean the same thing across members if everybody read
          the ends the same way. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {scaled && ask.anchorLow && (
          <span className="text-xs text-gray-500">{ask.anchorLow}</span>
        )}
        {choices.map((c) => (
          <button
            key={String(c)}
            onClick={() => answer(c)}
            disabled={busy}
            className="rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm text-gray-700 hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            {ask.type === 'NUMBER' && c === 5 ? '5+' : c}
          </button>
        ))}
        {scaled && ask.anchorHigh && (
          <span className="text-xs text-gray-500">{ask.anchorHigh}</span>
        )}
      </div>

      <p className="mt-2.5 text-xs text-gray-400">
        One question, and we won&apos;t ask again for a month.
      </p>
    </section>
  );
}
