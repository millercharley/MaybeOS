'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * What the booking is for (SPC-21).
 *
 * Clicking a slot used to book it outright, sending the room's own name as the
 * title — so the co-op's Google Calendar read "Attic" against a three-hour
 * block and an organiser walking past learned nothing about who was in there
 * or why.
 *
 * Every question below the title is optional. A member in a hurry types a name
 * and books; the rest is there for the ones organising something other people
 * will turn up to.
 */
export const GATHERING_KINDS = [
  'Art or expression',
  'Organising or meetings',
  'Social',
  'Learning',
  'Rehearsal or practice',
  'Care or support',
] as const;

export interface BookingDetails {
  title: string;
  description?: string;
  visibility: 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';
  expectedAttendance?: number;
  hasCost: boolean;
  categories: string[];
}

export function BookingDetailsForm({
  when,
  roomName,
  busy,
  onBack,
  onConfirm,
}: {
  when: string;
  roomName: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: (details: BookingDetails) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<BookingDetails['visibility']>('PRIVATE');
  const [attendance, setAttendance] = useState('');
  const [hasCost, setHasCost] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  // Functional update, because two chips clicked in quick succession both read
  // the same render's `categories` otherwise and the second silently discards
  // the first. Found by clicking two.
  const toggle = (kind: string) =>
    setCategories((current) =>
      current.includes(kind) ? current.filter((c) => c !== kind) : [...current, kind],
    );

  return (
    <div>
      <button
        onClick={onBack}
        disabled={busy}
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Pick a different time
      </button>

      <p className="mt-3 rounded-lg bg-[var(--surface-sunken)] px-4 py-3 text-center font-semibold">
        {roomName} · {when}
      </p>

      <label className="mt-4 block">
        <span className="text-sm font-medium">
          What is it? <span className="text-[var(--text-tertiary)]">Required</span>
        </span>
        <input
          type="text"
          className="input mt-1 w-full"
          placeholder="Working craft meeting"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
          This is what the room&apos;s calendar will show.
        </span>
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium">Anything else worth knowing?</span>
        <textarea
          className="input mt-1 w-full"
          rows={3}
          maxLength={2000}
          placeholder="Getting ready for an upcoming event. Team meeting, mixer, and craft day."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Who is it open to?</legend>
        <div className="mt-2 space-y-2">
          {(
            [
              ['PRIVATE', 'Just my guests', 'Nobody else is invited.'],
              ['MEMBERS_ONLY', 'Any member', 'Other members are welcome to join.'],
              ['PUBLIC', 'Anyone', 'Open to people outside the co-op too.'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                className="mt-1"
                checked={visibility === value}
                onChange={() => setVisibility(value)}
              />
              <span>
                <span className="font-medium">{label}</span>
                <br />
                <span className="text-[var(--text-secondary)]">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm font-medium">Roughly how many people?</span>
          <input
            type="number"
            min={1}
            max={10000}
            className="input mt-1 w-32"
            placeholder="15"
            value={attendance}
            onChange={(e) => setAttendance(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={hasCost}
            onChange={(e) => setHasCost(e.target.checked)}
          />
          There&apos;s a cost to attend
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">What kind of gathering?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {GATHERING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggle(kind)}
              aria-pressed={categories.includes(kind)}
              className={[
                'rounded-full border px-3 py-1 text-sm transition-colors',
                categories.includes(kind)
                  ? 'border-[var(--text-primary)] bg-[var(--surface-sunken)] font-medium'
                  : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]',
              ].join(' ')}
            >
              {kind}
            </button>
          ))}
        </div>
      </fieldset>

      <button
        onClick={() =>
          onConfirm({
            title: title.trim(),
            description: description.trim() || undefined,
            visibility,
            // Left out rather than sent as zero: "no answer" and "nobody is
            // coming" are different things.
            expectedAttendance: attendance ? parseInt(attendance, 10) : undefined,
            hasCost,
            categories,
          })
        }
        disabled={busy || !title.trim()}
        className="btn-primary mt-6 w-full"
      >
        {busy ? 'Booking…' : 'Book it'}
      </button>
    </div>
  );
}
