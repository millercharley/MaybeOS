'use client';

import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { api, type CloneResult, type Event } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Copying an event to a new date (EVT-38).
 *
 * Its own thing, not a repeat of one. A repeat is a rule somebody set; a
 * clone is "do that again" — last year's fundraiser, the workshop that went
 * well, the year of a weekly class that has run out.
 *
 * **The series question is asked, never assumed.** Somebody looking at one
 * Tuesday of a weekly class cannot tell from this screen whether Clone means
 * that Tuesday or all fifty-two, and a product that guesses is wrong half the
 * time. Where there is a series the choice is explicit, and copying the whole
 * run — dozens of rows — has to be said twice.
 *
 * Copying one is not confirmed twice. It is undone by deleting a draft, and
 * asking about it teaches people to click through the question that matters.
 */
export function CloneEvent({
  orgId,
  event,
  onCloned,
}: {
  orgId: string;
  event: Event;
  onCloned?: () => void;
}) {
  const token = useAuthStore((s) => s.token);

  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [withRooms, setWithRooms] = useState(true);
  const [scope, setScope] = useState<'one' | 'series' | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [plan, setPlan] = useState<CloneResult | null>(null);
  const [done, setDone] = useState<CloneResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const holdsRooms = (event.rooms?.length ?? 0) > 0;

  // Asked once, before anything else: the answer decides what the rest of
  // this panel is even about.
  const needsScope = plan?.hasSeries === true || done?.hasSeries === true;

  const body = (dryRun: boolean) => ({
    startTime: new Date(when).toISOString(),
    withRooms: holdsRooms && withRooms,
    ...(scope ? { scope } : {}),
    ...(scope === 'series' && confirmed ? { confirmSeries: true } : {}),
    dryRun,
  });

  async function run(dryRun: boolean) {
    if (!token || !when) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.events.clone(orgId, event.id, body(dryRun), token);
      if (dryRun) setPlan(result);
      else {
        setDone(result);
        setPlan(null);
        onCloned?.();
      }
    } catch (err) {
      // The API refuses a missing scope and an unconfirmed series, each with
      // a sentence naming how many events are involved. That is the prompt.
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <p className="text-sm text-gray-900">
          Copied <strong>{done.copies}</strong> {done.copies === 1 ? 'event' : 'events'}
          {typeof done.roomsHeld === 'number' && done.roomsHeld > 0 && (
            <> and held the room {done.roomsHeld} times</>
          )}
          , as drafts.
        </p>
        {done.droppedPastAYear > 0 && (
          <p className="mt-2 text-amber-800">
            {done.droppedPastAYear} of the series fell more than a year past the new start, so
            they were left out. Clone again from the last one to carry on.
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Nobody has been told about them. Publish the ones you want.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand-600"
      >
        <Copy className="h-4 w-4" /> Clone this event
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <label className="block text-sm text-gray-700">
        When should the copy be?
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => {
            setWhen(e.target.value);
            setPlan(null);
            setError('');
          }}
          className="input mt-1 block"
        />
      </label>

      {needsScope && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-900">
            This event is one of {(plan ?? done)?.seriesLength} in a series
          </legend>
          <div className="mt-2 space-y-2">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="clone-scope"
                checked={scope === 'one'}
                onChange={() => {
                  setScope('one');
                  setConfirmed(false);
                  setPlan(null);
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-gray-900">Just this one</span>
                <span className="mt-0.5 block text-gray-500">
                  One copy, on the date above.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="clone-scope"
                checked={scope === 'series'}
                onChange={() => {
                  setScope('series');
                  setConfirmed(false);
                  setPlan(null);
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-gray-900">
                  The whole series — all {(plan ?? done)?.seriesLength}
                </span>
                <span className="mt-0.5 block text-gray-500">
                  The same spacing, shifted so the first lands on the date above. A year is
                  as far as it reaches.
                </span>
              </span>
            </label>
          </div>

          {/* The second half of the opt-in, for the choice that writes dozens
              of rows. Copying one is not worth a second question. */}
          {scope === 'series' && (
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  setPlan(null);
                }}
                className="mt-1"
              />
              <span className="text-amber-900">
                Yes — copy all {(plan ?? done)?.seriesLength} of them
                {holdsRooms && withRooms && ', and hold the rooms where they are free'}.
              </span>
            </label>
          )}
        </fieldset>
      )}

      {holdsRooms && (
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={withRooms}
            onChange={(e) => {
              setWithRooms(e.target.checked);
              setPlan(null);
            }}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-gray-900">Hold the same room</span>
            <span className="mt-0.5 block text-gray-500">
              Skipped where the room is already taken on the new date.
            </span>
          </span>
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {plan && !error && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="text-gray-900">
            <strong>{plan.copies}</strong> {plan.copies === 1 ? 'copy' : 'copies'}
            {plan.lastOn && plan.copies > 1 && (
              <>
                , the last on{' '}
                {new Date(plan.lastOn).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </>
            )}
            .
          </p>
          {plan.droppedPastAYear > 0 && (
            <p className="mt-1 text-amber-800">
              {plan.droppedPastAYear} fall more than a year past the new start and will be
              left out.
            </p>
          )}
          <p className="mt-1 text-gray-500">Made as drafts; nobody is told until you publish.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {plan && !error ? (
          <button
            type="button"
            onClick={() => run(false)}
            disabled={busy || plan.copies === 0}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Make {plan.copies} {plan.copies === 1 ? 'copy' : 'copies'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy || !when}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Preview the copy
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPlan(null);
            setError('');
          }}
          className="btn-ghost"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
