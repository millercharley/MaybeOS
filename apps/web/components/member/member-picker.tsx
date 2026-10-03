'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { api, type Member } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Find a member by typing their name (EVT-32).
 *
 * Charley: "Make sure it's easy to start typing the name of a member and a
 * list appears of matches as the person types."
 *
 * The search is the server's, not a filter over a page of members already
 * loaded — MaybeItsFate has 437, and a picker that searched the first twenty
 * would be the Members page bug again in a smaller box (MEM-22).
 *
 * Nothing is fetched until somebody types. A list of members that appears on
 * focus is a list somebody has to dismiss before they can do anything, and on
 * a roster this size the first twenty names are not an answer to any question.
 */
export function MemberPicker({
  orgId,
  onPick,
  placeholder = 'Start typing a name…',
  exclude = [],
  busy = false,
}: {
  orgId: string;
  onPick: (member: Member) => void;
  placeholder?: string;
  /** Members already on this event, so they are not offered twice. */
  exclude?: string[];
  busy?: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (!token || text.length < 2) {
      setResults(null);
      setError('');
      return;
    }

    // A pause, so typing a name is one search rather than eight.
    const id = setTimeout(async () => {
      const mine = ++latest.current;
      setSearching(true);
      setError('');
      try {
        const page = await api.members.list(orgId, token, 1, 8, text);
        // Only the newest search may write: a slow early request landing
        // after a later one would replace the right answer with a stale one.
        if (mine === latest.current) setResults(page.data);
      } catch (err) {
        if (mine === latest.current) {
          setError(err instanceof Error ? err.message : 'Could not search members');
        }
      } finally {
        if (mine === latest.current) setSearching(false);
      }
    }, 250);

    return () => clearTimeout(id);
  }, [query, orgId, token]);

  const offered = (results ?? []).filter((m) => !exclude.includes(m.user.id));

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          aria-label="Search members by name"
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
        ) : (
          query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {results !== null && !error && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
          {offered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">
              {results.length === 0
                ? 'Nobody by that name.'
                : // Found, but already on the event — which is an answer.
                  'Everybody matching is already on this event.'}
            </li>
          ) : (
            offered.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onPick(member);
                    setQuery('');
                    setResults(null);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
                    {(member.user.name ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate font-medium text-gray-900">
                    {member.user.name ?? 'Member'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
