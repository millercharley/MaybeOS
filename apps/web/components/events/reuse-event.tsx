'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, Search } from 'lucide-react';
import { api, type ReusableEvent } from '@/lib/api';
import { timeAgo } from '@/lib/relative-time';

/**
 * Start a new event from one you already ran (EVT-48).
 *
 * Charley: "When a user creates a new event, provide an option to reuse a
 * previous event to pre-fill the event information (everything except the date
 * and the room). Provide a text-based search to find any event they were a
 * host or co-host."
 *
 * **A search, not a dropdown.** Modelled on `MemberPicker` for the reason it
 * was: a co-op's event list is 767 rows at MaybeItsFate, and a `<select>` of
 * those is the Members page bug in a smaller box (MEM-22). Nothing is fetched
 * until somebody opens it, and typing narrows it.
 *
 * **One row per title**, decided on the server: Board Games Club is 46 events
 * and one thing the co-op runs. The row shows that one's date, so two similar
 * names can be told apart, and when it was last edited — which is how the
 * server picks it, and the thing a member working through a migrated series
 * most needs to see.
 *
 * **Offered while editing, too.** Charley: "it's actually important to offer
 * the ability to clone the info while in the Edit mode for an event… All
 * migrated events will need editing. I can imagine the member editing one
 * event, then using the clone option to pre-fill the fields, image, etc. for
 * each additional cloned event." The worry this was held back for — somebody
 * opening an event to fix a typo and having its description replaced — does
 * not survive the control being two deliberate clicks deep and saving
 * nothing.
 */
export function ReuseEvent({
  orgId,
  token,
  onPick,
  editing = false,
  excludeId,
}: {
  orgId: string;
  token: string;
  onPick: (event: ReusableEvent) => void;
  /** Changes what this is called and what it promises, not what it does. */
  editing?: boolean;
  /** The event being edited, which is never offered as its own source. */
  excludeId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReusableEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;

    // A pause, so typing a name is one search rather than eight. Unlike the
    // member picker this searches on an empty box too: "what have I run
    // lately" is the question somebody opening this usually has.
    const id = setTimeout(async () => {
      const mine = ++latest.current;
      setLoading(true);
      setError('');
      try {
        const list = await api.events.reusable(
          orgId,
          token,
          query.trim() || undefined,
          excludeId,
        );
        // Only the newest search may write: a slow early request landing
        // after a later one would replace the right answer with a stale one.
        if (mine === latest.current) setResults(list);
      } catch (err) {
        if (mine === latest.current) {
          setError(err instanceof Error ? err.message : 'Could not look up your events.');
        }
      } finally {
        if (mine === latest.current) setLoading(false);
      }
    }, 250);

    return () => clearTimeout(id);
  }, [open, query, orgId, token, excludeId]);

  const lastRan = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      // Always, here. These are years apart by nature, and "14 Oct" on a row
      // meant to tell two similar events apart says nothing (SPC-23).
      year: 'numeric',
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
      >
        <Copy size={14} aria-hidden="true" />
        {editing ? 'Fill these in from another event' : 'Start from a previous event'}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900">
          Which event is it like?
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          Never mind
        </button>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        Everything but the date and the room is copied in, and you can change any of it
        {editing
          ? ' before saving. Nothing is written until you save this event.'
          : ' before saving.'}
      </p>

      <div className="relative mt-2">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="search"
          className="input pl-8"
          placeholder="Search your events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search your events"
        />
      </div>

      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}

      {loading && (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Looking…
        </p>
      )}

      {!loading && results?.length === 0 && (
        <p className="mt-2 text-sm text-gray-500">
          {query.trim()
            ? 'Nothing of yours matches that.'
            : 'You have not run anything yet, so there is nothing to copy.'}
        </p>
      )}

      {!loading && results && results.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100">
          {results.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(event);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {event.title}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {lastRan(event.startTime)} · edited {timeAgo(event.updatedAt)}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-brand-600">Use this</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
