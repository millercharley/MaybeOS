'use client';

import { Signals, SignalCategory } from '@/lib/api';

export const CATEGORY_LABEL: Record<string, string> = {
  belonging: 'Belonging',
  loneliness: 'Loneliness',
  network_size: 'People they know here',
  participation: 'Taking part',
  civic_engagement: 'Beyond the co-op',
};

/**
 * What a co-op learned, drawn the same way for organisers and members (IMP-20).
 *
 * One component, two audiences, deliberately: §10 says individual responses
 * are never exposed, and the surest way to keep a member's view and an
 * organiser's view honest with each other is for them to be the same view.
 * There is no looser variant for admins and no vaguer one for members.
 *
 * The bar is drawn against the scale, not against the other categories. A
 * chart normalised to its own maximum makes 3.1 look like a triumph beside
 * 3.0, which is how a wellbeing figure becomes a marketing figure.
 */
export function SignalsView({ signals }: { signals: Signals }) {
  const reportable = signals.categories.filter((c) => c.reportable);
  const withheld = signals.categories.filter((c) => !c.reportable);

  if (signals.categories.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
        Nothing answered yet. Figures appear once{' '}
        {signals.suppressionThreshold} people have answered a question.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {reportable.length > 0 && (
        <div className="space-y-4">
          {reportable.map((c) => (
            <CategoryBar key={c.category} category={c} />
          ))}
        </div>
      )}

      {/* Named rather than hidden. A category quietly missing reads as a
          category nobody asked about, when in fact it is one too few people
          have answered — which is a different thing, and fixable. */}
      {withheld.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">
            Not enough answers yet to show
          </p>
          <ul className="mt-2 space-y-1 text-sm text-gray-600">
            {withheld.map((c) => (
              <li key={c.category}>
                {CATEGORY_LABEL[c.category] ?? c.category} —{' '}
                {c.respondents} of {signals.suppressionThreshold} people
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Figures are only shown once at least {signals.suppressionThreshold} people have
            answered, so that no one&apos;s answer can be worked out from them.
          </p>
        </div>
      )}

      {signals.windows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Collection windows</h3>
          <ul className="mt-2 space-y-1.5">
            {signals.windows.map((w) => (
              <li key={w.windowId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-gray-900">{w.label}</span>
                <span className="text-gray-500">
                  {w.responses} of {signals.members} members ({w.responseRate}%)
                </span>
                {!w.closesAt && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    open
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* G5, said in words: a figure with no window and no count is a
              claim a funder discounts. */}
          <p className="mt-2 text-xs text-gray-400">
            Every figure above comes from these windows and these counts.
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryBar({ category: c }: { category: SignalCategory }) {
  // The instrument is 1–5 throughout, and the bar is drawn against that
  // rather than against the largest value on screen.
  const pct = c.average === null ? 0 : Math.max(0, Math.min(100, ((c.average - 1) / 4) * 100));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-gray-900">
          {CATEGORY_LABEL[c.category] ?? c.category}
        </span>
        <span className="text-sm tabular-nums text-gray-900">
          {c.average?.toFixed(1)}
          <span className="text-gray-400"> / 5</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${c.higherIsBetter ? 'bg-brand-500' : 'bg-amber-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {c.respondents} {c.respondents === 1 ? 'person' : 'people'}, {c.answerCount}{' '}
        {c.answerCount === 1 ? 'answer' : 'answers'}
        {/* Without this, 4.2 loneliness reads like 4.2 belonging. */}
        {!c.higherIsBetter && ' · lower is better here'}
      </p>
    </div>
  );
}
