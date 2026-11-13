'use client';

import { X } from 'lucide-react';

/**
 * "Everything is in here" — pointed at the hamburger, once (NAV-05).
 *
 * Presentation only. The shell owns whether this is on screen and what
 * pressing it does, because the same state also opens the drawer and lights
 * up a section inside it, and a tour whose steps each remembered themselves
 * would be three components disagreeing about where the reader had got to.
 *
 * Deliberately not a modal. It does not trap focus, it does not cover the
 * page, and the member can ignore it and carry on reading the dashboard
 * underneath — the thing it is pointing at was always available, and the tip
 * should not be more insistent than the feature.
 */
export function NavCoach({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <div
      role="note"
      aria-label="Where to find everything"
      className="absolute left-0 top-full z-40 mt-2 w-64 lg:hidden"
    >
      {/* The pointer, under the icon it is about. */}
      <span
        aria-hidden="true"
        className="absolute left-4 top-[-3px] h-2.5 w-2.5 rotate-45 rounded-[2px] bg-ink"
      />

      <div className="relative rounded-xl bg-ink p-3 shadow-lg">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 rounded p-1 text-paper-deep/60 transition-colors hover:bg-white/10 hover:text-paper"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <p className="pr-5 text-sm font-semibold text-paper">Everything is in here</p>
        <p className="mt-1 text-xs leading-relaxed text-paper-deep">
          Your events, bookings, dues — and your door code.
        </p>

        <button
          type="button"
          onClick={onOpen}
          className="mt-2.5 rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Show me
        </button>
      </div>
    </div>
  );
}
