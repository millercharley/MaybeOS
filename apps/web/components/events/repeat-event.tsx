'use client';

import { useState } from 'react';
import { Loader2, Repeat } from 'lucide-react';
import { api, type Event, type RepeatResult } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Repeating an event, the way Google Calendar asks (EVT-37).
 *
 * Every n days / weeks / months / years, weekly on a chosen set of days,
 * ending after a count or on a date. The one thing Google does not have to
 * think about is the rooms: a room is exclusive, so the preview says how many
 * dates are already taken before anything is written.
 *
 * Preview first, always. Fifty-two events and fifty-two reservations is not
 * something to find out about afterwards.
 */
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function RepeatEvent({
  orgId,
  event,
  onChangedDone,
}: {
  orgId: string;
  event: Event;
  onChangedDone?: () => void;
}) {
  const token = useAuthStore((s) => s.token);

  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'>('WEEKLY');
  const [interval, setIntervalValue] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([new Date(event.startTime).getDay()]);
  const [ends, setEnds] = useState<'count' | 'on'>('count');
  const [count, setCount] = useState('12');
  const [until, setUntil] = useState('');
  const [withRooms, setWithRooms] = useState(true);

  const [plan, setPlan] = useState<RepeatResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<RepeatResult | null>(null);

  const holdsRooms = (event.rooms?.length ?? 0) > 0;

  const body = () => ({
    frequency,
    interval: Math.max(1, Number(interval) || 1),
    ...(frequency === 'WEEKLY' && weekdays.length ? { weekdays } : {}),
    ...(ends === 'count' ? { count: Math.max(1, Number(count) || 1) } : {}),
    ...(ends === 'on' && until ? { until: new Date(`${until}T23:59:59`).toISOString() } : {}),
    withRooms: holdsRooms && withRooms,
  });

  async function run(dryRun: boolean) {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      if (dryRun) {
        setPlan(await api.events.repeat(orgId, event.id, { ...body(), dryRun: true }, token));
        return;
      }

      /*
        In as many requests as it takes (EVT-38).

        A year of a daily event is 366 events and 366 reservations, which does
        not fit in a Lambda. The API says where it stopped; this keeps asking,
        bounded so a server answering with the same index cannot spin here.
      */
      let total: RepeatResult | null = null;
      let fromIndex: number | undefined;

      for (let request = 0; request < 20; request += 1) {
        const chunk = await api.events.repeat(
          orgId,
          event.id,
          { ...body(), dryRun: false, ...(fromIndex === undefined ? {} : { fromIndex }) },
          token,
        );

        total = total
          ? {
              ...chunk,
              occurrences: total.occurrences + chunk.occurrences,
              roomsHeld: (total.roomsHeld ?? 0) + (chunk.roomsHeld ?? 0),
            }
          : chunk;
        setDone(total);

        if (chunk.next === null || chunk.next === undefined) break;
        fromIndex = chunk.next;
      }

      setPlan(null);
      onChangedDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <p className="text-sm text-gray-900">
          Made <strong>{done.occurrences}</strong> more{' '}
          {done.occurrences === 1 ? 'event' : 'events'}, as drafts
          {typeof done.roomsHeld === 'number' && done.roomsHeld > 0 && (
            <> and held the room {done.roomsHeld} times</>
          )}
          .
        </p>
        {done.roomClashes > 0 && (
          // The thing to say out loud rather than bury.
          <p className="mt-2 text-sm text-amber-800">
            {done.roomClashes} of them fall when the room is already taken, so no room was
            held for those. They are in your drafts — move them, or book a different room.
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          They are drafts, so nobody has been told about them yet. Publish the ones you want.
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
        <Repeat className="h-4 w-4" /> Repeat this event
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-700">Repeat every</span>
        <input
          type="number"
          min="1"
          max="52"
          value={interval}
          onChange={(e) => {
            setIntervalValue(e.target.value);
            setPlan(null);
          }}
          className="input w-20"
          aria-label="How often"
        />
        <select
          value={frequency}
          onChange={(e) => {
            setFrequency(e.target.value as typeof frequency);
            setPlan(null);
          }}
          className="input w-36"
          aria-label="Day, week, month or year"
        >
          <option value="DAILY">day</option>
          <option value="WEEKLY">week</option>
          <option value="MONTHLY">month</option>
          <option value="YEARLY">year</option>
        </select>
      </div>

      {frequency === 'WEEKLY' && (
        <div className="mt-4">
          <span className="block text-sm text-gray-700">Repeat on</span>
          <div className="mt-2 flex gap-2">
            {DAYS.map((label, day) => (
              <button
                key={day}
                type="button"
                aria-label={
                  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]
                }
                aria-pressed={weekdays.includes(day)}
                onClick={() => {
                  setPlan(null);
                  setWeekdays((current) =>
                    current.includes(day)
                      ? // Never empty: with no day chosen there is nothing to
                        // repeat, and the API would fall back to the first
                        // one's day anyway.
                        current.length === 1
                        ? current
                        : current.filter((d) => d !== day)
                      : [...current, day],
                  );
                }}
                className={[
                  'h-9 w-9 rounded-full text-sm transition-colors',
                  weekdays.includes(day)
                    ? 'bg-brand-600 font-medium text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <fieldset className="mt-4">
        <legend className="text-sm text-gray-700">Ends</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="repeat-ends"
              checked={ends === 'count'}
              onChange={() => {
                setEnds('count');
                setPlan(null);
              }}
            />
            After
            <input
              type="number"
              min="1"
              max="200"
              value={count}
              onChange={(e) => {
                setCount(e.target.value);
                setPlan(null);
              }}
              disabled={ends !== 'count'}
              className="input w-24"
              aria-label="How many times"
            />
            times
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="repeat-ends"
              checked={ends === 'on'}
              onChange={() => {
                setEnds('on');
                setPlan(null);
              }}
            />
            On
            <input
              type="date"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setPlan(null);
              }}
              disabled={ends !== 'on'}
              className="input"
              aria-label="Repeat until"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          There is no &ldquo;never&rdquo;: each one is a real event with its own RSVPs and its
          own room, so a co-op sets a year and extends it.
        </p>
      </fieldset>

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
            <span className="font-medium text-gray-900">Hold the room each time</span>
            <span className="mt-0.5 block text-gray-500">
              Dates where the room is already taken are reported rather than booked.
            </span>
          </span>
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {plan && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="text-gray-900">
            {plan.occurrences === 0 ? (
              'That makes no new dates — check the ending.'
            ) : (
              <>
                <strong>{plan.occurrences}</strong> more{' '}
                {plan.occurrences === 1 ? 'event' : 'events'}
                {plan.lastOn && (
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
              </>
            )}
          </p>
          {plan.roomClashes > 0 && (
            <p className="mt-1 text-amber-800">
              {plan.roomClashes} of them fall when the room is already taken. Those will be
              made without a room.
            </p>
          )}
          {plan.stopsAtAYear && (
            // Said before they press it, not after (EVT-38).
            <p className="mt-1 text-gray-600">
              A repeat reaches one year. Clone it nearer the time to carry on into the year
              after.
            </p>
          )}
          <p className="mt-1 text-gray-500">
            They are made as drafts, so nobody is told until you publish them.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {plan ? (
          <button
            type="button"
            onClick={() => run(false)}
            disabled={busy || plan.occurrences === 0}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Make {plan.occurrences} {plan.occurrences === 1 ? 'event' : 'events'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Preview the dates
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
