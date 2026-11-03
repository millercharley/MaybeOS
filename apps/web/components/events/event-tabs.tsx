'use client';

import { Search } from 'lucide-react';
import type { EventTab } from '@/lib/event-tabs';

/**
 * Upcoming or past, and a box to search whichever is showing (EVT-49).
 *
 * Charley: "Always provide a second tab on any screen where previous events
 * are listed so that previous events all live together and are searchable,
 * not listed with upcoming events."
 *
 * One component, used by every screen that lists events, so the three that
 * each grew their own stacked "Past" section cannot drift apart again. The
 * pills are the ones My Bookings has had since SPC-23 — a member should not
 * have to learn a second way to look at their own history on the next page
 * along.
 *
 * **The search box is on both tabs.** The ask is that the past be
 * searchable, and it is; but a co-op that has imported its calendar has 183
 * events still to come as well as 584 behind it, so hiding the box on the
 * upcoming tab would solve half of a problem and make the control appear and
 * disappear as somebody switches.
 */
export function EventTabs({
  tab,
  onTab,
  counts,
  search,
  onSearch,
  label = 'Which events',
  searchPlaceholder = 'Search events…',
  extraTabs,
}: {
  tab: string;
  onTab: (tab: EventTab | string) => void;
  /** Shown on the pills, so "Past" does not look empty before it is opened. */
  counts?: Partial<Record<string, number>>;
  search: string;
  onSearch: (text: string) => void;
  label?: string;
  searchPlaceholder?: string;
  /**
   * Anything a screen needs beyond the two (the admin console's Draft).
   *
   * Deliberately after the two rather than mixed among them: upcoming and
   * past are the split this rule is about, and a third pill between them
   * would read as a third kind of date.
   */
  extraTabs?: { key: string; label: string }[];
}) {
  const pills = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    ...(extraTabs ?? []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-2" role="tablist" aria-label={label}>
        {pills.map((pill) => {
          const count = counts?.[pill.key];
          return (
            <button
              key={pill.key}
              type="button"
              role="tab"
              aria-selected={tab === pill.key}
              onClick={() => onTab(pill.key)}
              className={
                tab === pill.key
                  ? 'rounded-full bg-[var(--surface-strong,#1f2937)] px-4 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted,#f3f4f6)]'
              }
            >
              {pill.label}
              {count !== undefined && count > 0 && (
                <span className="ml-1.5 opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-w-[12rem] flex-1">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
        <input
          type="search"
          className="input w-full pl-8"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label={searchPlaceholder}
        />
      </div>
    </div>
  );
}
