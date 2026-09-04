'use client';

import { clsx } from 'clsx';

/**
 * An on/off switch that reads as one.
 *
 * Charley, 2026-09-04, on the getting-started setting: a checkbox does not say
 * "this is on". A checkbox is for choosing items out of a set — tick the three
 * you want — and settings are not a set, they are a state. The difference
 * shows in the words next to it: a checkbox wants a noun ("Email me updates"),
 * a switch wants to *show* its state without needing one.
 *
 * Still a real `<input type="checkbox">` underneath, styled with peer classes.
 * A hand-rolled `<div role="switch">` has to reimplement focus, the space bar,
 * form participation and the accessibility tree, and every one of those is a
 * thing that gets forgotten. `role="switch"` on the input is the one addition:
 * it tells a screen reader this is a state rather than a selection, which is
 * exactly the distinction the visual change is making.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Shown beside the switch. Reads as the state, not as an instruction. */
  label?: string;
  description?: string;
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={clsx(
        'flex items-center gap-3',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        {/* The track. Brand red when on, so it matches every other "this is
            active" in the product rather than inventing a green nothing else
            uses. */}
        <span
          aria-hidden
          className={clsx(
            'block h-6 w-11 rounded-full border transition-colors duration-fast',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]',
            checked ? 'border-brand-600 bg-brand-600' : 'border-gray-300 bg-gray-200',
          )}
        />
        {/* The knob, moved rather than redrawn, so the motion reads as one
            thing sliding instead of two states swapping. */}
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-fast',
            checked && 'translate-x-5',
          )}
        />
      </span>

      {(label || description) && (
        <span className="min-w-0">
          {label && (
            <span className="block text-sm font-medium text-gray-900">{label}</span>
          )}
          {description && (
            <span className="block text-xs text-gray-500">{description}</span>
          )}
        </span>
      )}
    </label>
  );
}
