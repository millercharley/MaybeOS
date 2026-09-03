'use client';

import { useState } from 'react';
import type { DutyInput, Recurrence } from '@/lib/api';

/**
 * Naming something that needs doing (SRV-01).
 *
 * Four fields answer the ordinary case — what, how long, when, how often —
 * and the two that matter less often sit below. A rota an organiser has to
 * fill in eleven fields to add a bin run to is a rota with one duty on it.
 */
const RECURRENCES: { value: Recurrence; label: string }[] = [
  { value: 'NONE', label: 'Just once' },
  { value: 'DAILY', label: 'Every day' },
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'BIWEEKLY', label: 'Every other week' },
  { value: 'MONTHLY', label: 'Every month' },
];

export function DutyForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: DutyInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [recurrence, setRecurrence] = useState<Recurrence>('WEEKLY');
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [capacity, setCapacity] = useState('1');
  const [requiresApproval, setRequiresApproval] = useState(false);

  const estimate = parseInt(hours || '0', 10) * 60 + parseInt(minutes || '0', 10);
  const ready = title.trim().length > 0 && estimate >= 5;

  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium">
          What needs doing? <span className="text-[var(--text-tertiary)]">Required</span>
        </span>
        <input
          type="text"
          className="input mt-1 w-full"
          maxLength={120}
          placeholder="Take the bins out"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium">Anything a member should know?</span>
        <textarea
          className="input mt-1 w-full"
          rows={2}
          maxLength={2000}
          placeholder="Blue bin to the kerb by 8am. Key for the bin store is behind the desk."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">
          How long does one turn take?
        </legend>
        <div className="mt-1 flex items-end gap-2">
          <label className="block">
            <input
              type="number"
              min={0}
              max={23}
              className="input w-20"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--text-tertiary)]">hours</span>
          </label>
          <label className="block">
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              className="input w-20"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--text-tertiary)]">minutes</span>
          </label>
        </div>
        {/* Said plainly, because this is the number that lands on somebody's
            record and the one a tier requirement is measured against. */}
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          This is what a member is credited when they mark it done. They can correct it.
        </p>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm font-medium">How often?</span>
          <select
            className="input mt-1"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as Recurrence)}
          >
            {RECURRENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">
            {recurrence === 'NONE' ? 'On' : 'Starting'}
          </span>
          <input
            type="date"
            className="input mt-1"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">At</span>
          <input
            type="time"
            className="input mt-1"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>

        {recurrence !== 'NONE' && (
          <label className="block">
            <span className="text-sm font-medium">Until</span>
            <input
              type="date"
              className="input mt-1"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
            <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
              Leave blank to keep going
            </span>
          </label>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm font-medium">How many people?</span>
          <input
            type="number"
            min={1}
            max={50}
            className="input mt-1 w-24"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />
          I&apos;ll confirm who takes this
        </label>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={() =>
            onSubmit({
              title: title.trim(),
              description: description.trim() || undefined,
              estimatedMinutes: estimate,
              capacity: parseInt(capacity, 10) || 1,
              requiresApproval,
              recurrence,
              startsOn,
              // Omitted rather than sent empty: an empty string is not a date,
              // and "no end" is a real answer.
              ...(recurrence !== 'NONE' && endsOn ? { endsOn } : {}),
              startTime,
            })
          }
          disabled={busy || !ready}
          className="btn-primary"
        >
          {busy ? 'Adding…' : 'Add it to the rota'}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
