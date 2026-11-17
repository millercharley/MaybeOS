'use client';

import { CalendarPlus, X } from 'lucide-react';
import type { OfferingSessionInput } from '@/lib/api';

/**
 * The dates, while a workshop is still being written up (TCH-02).
 *
 * Charley: a member should be able to add dates **if they know them**, at the
 * point they write the workshop up — rather than saving, finding the
 * workshop again and adding them one at a time.
 *
 * So this is optional and starts empty. A workshop with no dates is a state
 * the product has a name for ("Gathering interest"), not a form somebody
 * failed to finish, and nothing here pushes a teacher towards inventing a
 * date to get past it.
 *
 * Deliberately the same three questions as `SessionScheduler` and no more.
 * Rooms, tickets, images and co-hosts are set on each date's own event
 * screen, which already has all of it — asking here would be a second event
 * form to keep in step with the first.
 *
 * **These save unpublished.** Nothing reaches the co-op calendar until the
 * workshop itself is published, which is what the panel after saving is for.
 */
export function DateRows({
  rows,
  onChange,
}: {
  rows: OfferingSessionInput[];
  onChange: (rows: OfferingSessionInput[]) => void;
}) {
  const edit = (index: number, patch: Partial<OfferingSessionInput>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const add = () =>
    onChange([...rows, { title: '', startTime: '', endTime: '', capacity: null }]);

  const drop = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-gray-700">
        Dates <span className="font-normal opacity-70">Optional.</span>
      </legend>
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        Add them if you know them. You can put the workshop up without any and see who is
        interested first.
      </p>

      {rows.length > 0 && (
        <ul className="mb-3 space-y-3">
          {rows.map((row, index) => (
            <li key={index} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">Date {index + 1}</span>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-sm"
                  onClick={() => drop(index)}
                >
                  <X className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  Remove
                  <span className="sr-only"> date {index + 1}</span>
                </button>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm text-[var(--text-secondary)]">
                  What this session is called
                </span>
                <input
                  className="input w-full"
                  value={row.title}
                  onChange={(e) => edit(index, { title: e.target.value })}
                  placeholder="Week one: centring"
                />
              </label>

              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-[var(--text-secondary)]">Starts</span>
                  <input
                    type="datetime-local"
                    className="input w-full"
                    value={row.startTime}
                    onChange={(e) => edit(index, { startTime: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-[var(--text-secondary)]">Finishes</span>
                  <input
                    type="datetime-local"
                    className="input w-full"
                    value={row.endTime}
                    onChange={(e) => edit(index, { endTime: e.target.value })}
                  />
                </label>
              </div>

              <label className="mt-2 block sm:max-w-[12rem]">
                <span className="mb-1 block text-sm text-[var(--text-secondary)]">
                  How many people <span className="opacity-70">Optional.</span>
                </span>
                <input
                  className="input w-full"
                  inputMode="numeric"
                  value={row.capacity == null ? '' : String(row.capacity)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    edit(index, { capacity: digits ? Number(digits) : null });
                  }}
                  placeholder="8"
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn-secondary text-sm" onClick={add}>
        <CalendarPlus className="mr-1.5 inline h-4 w-4" aria-hidden />
        {rows.length === 0 ? 'Add a date' : 'Add another date'}
      </button>
    </fieldset>
  );
}
