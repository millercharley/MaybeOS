'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Search, X } from 'lucide-react';
import { api, ApiError, type Member, type OwnedEventGroup } from '@/lib/api';
import { MemberPicker } from '@/components/member/member-picker';
import { emptyNote, searchEvents, splitSeries, type EventTab } from '@/lib/event-tabs';

/**
 * Handing somebody's events to the member who actually runs them (EVT-47).
 *
 * Charley: "As an admin, I want to transfer events to a new owner. From the
 * calendar migration, I have a lot of events in MaybeItsFate that are still
 * owned by me (c@maybeitsfate.com) that I want to remove from My Events and
 * make sure the real member who manages the event see all of this recurring
 * event listed under their My Events to manage."
 *
 * 769 of them, 183 still to come. They are his because the calendar import
 * creates what it finds under the account whose calendar it read — the same
 * reason 3,017 room reservations arrived as his (SPC-23).
 *
 * **Two member pickers, in this order: whose, then whose instead.** The first
 * is the question nobody can answer for an admin — MaybeOS has no record of
 * who really ran these (`hostEmail` is null on all 769), so it must not
 * appear to guess. The second is asked per series, because that is the grain
 * the answer actually comes in: Board Games Club is one member's, Improv Club
 * is another's.
 *
 * One row per thing the co-op runs, not 769 rows of dates. Forty-six Board
 * Games Clubs were forty-six trips through a member picker.
 */
export function TransferEvents({
  orgId,
  token,
  onDone,
  onClose,
}: {
  orgId: string;
  token: string;
  /** Reload the event list, since the host column on it has changed. */
  onDone?: () => void;
  onClose?: () => void;
}) {
  const [from, setFrom] = useState<Member | null>(null);
  const [owned, setOwned] = useState<{ total: number; groups: OwnedEventGroup[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Which series is being handed over, and to whom once they have been picked. */
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /*
    Two tabs and a search box (EVT-52), for the same reason every other event
    list in the product has them (EVT-49) — and this is the screen that needed
    them most. MaybeItsFate's list is 287 series, of which eight have a date
    still to come. Those eight are the entire live problem: a member who
    cannot edit next Tuesday's event. The other 279 ended, some in 2024, and
    were sharing one scroll with them.

    The standing sweep missed this screen because it lists series rather than
    events, so neither the rule nor the guard that enforces it recognised it
    as a place where events are listed.
  */
  const [tab, setTab] = useState<EventTab>('upcoming');
  const [find, setFind] = useState('');

  const load = useCallback(async () => {
    if (!from) return;
    setLoading(true);
    setError(null);
    try {
      setOwned(await api.events.ownedBy(orgId, from.user.id, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load their events.');
    } finally {
      setLoading(false);
    }
  }, [orgId, token, from]);

  useEffect(() => {
    load();
  }, [load]);

  /*
    Split first, then search inside the tab. The other way round would let a
    search on the Finished tab quietly answer with something that is still to
    come, which is the one thing the tabs exist to stop.
  */
  const split = useMemo(() => splitSeries(owned?.groups ?? []), [owned]);
  const shown = useMemo(
    () => searchEvents(split[tab], find, (group) => [group.title]),
    [split, tab, find],
  );

  async function hand(group: OwnedEventGroup, to: Member) {
    if (!from) return;
    setBusy(group.title);
    setError(null);
    setNotice(null);
    try {
      /*
        The ids the admin was shown, not the title.

        Sending the title would re-run the search at write time, and could
        move something created in between — the API would accept it, because
        it would still be one of theirs.
      */
      const result = await api.events.transferHost(
        orgId,
        { fromUserId: from.user.id, toUserId: to.user.id, eventIds: group.eventIds },
        token,
      );

      const who = to.user.name ?? 'them';
      setNotice(
        result.refused.length === 0
          ? `${result.moved} ${result.moved === 1 ? 'event' : 'events'} handed to ${who}. ${
              result.moved === 1 ? 'It is' : 'They are'
            } in their My Events now.`
          : `${result.moved} handed to ${who}. ${result.refused.length} left where ${
              result.refused.length === 1 ? 'it was' : 'they were'
            }: ${result.refused[0].reason}`,
      );
      setOpen(null);
      await load();
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not hand those over.');
    } finally {
      setBusy(null);
    }
  }

  const span = (group: OwnedEventGroup) => {
    const year = (iso: string) => new Date(iso).getFullYear();
    const first = year(group.firstStart);
    const last = year(group.lastStart);
    return first === last ? `${first}` : `${first}–${last}`;
  };

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Transfer events to a new host</h2>
          <p className="mt-1 text-sm text-gray-700">
            For events the calendar import filed under whoever&rsquo;s calendar it read. The new
            host sees them under My Events and can edit them; they leave the old host&rsquo;s
            list.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-4 flex gap-3 rounded-lg border border-[var(--success)] p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]" />
          <p className="text-sm">{notice}</p>
        </div>
      )}
      {error && (
        <div className="mb-4 flex gap-3 rounded-lg border border-[var(--danger)] p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger)]" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div>
        <span className="mb-1 block text-sm font-medium text-gray-900">Whose events?</span>
        {from ? (
          <p className="text-sm text-gray-700">
            {from.user.name ?? 'Member'}
            <button
              type="button"
              onClick={() => {
                setFrom(null);
                setOwned(null);
                setOpen(null);
                setNotice(null);
              }}
              className="ml-3 text-xs font-medium text-brand-600 hover:underline"
            >
              Somebody else
            </button>
          </p>
        ) : (
          <MemberPicker
            orgId={orgId}
            placeholder="Search for the member who owns them…"
            onPick={setFrom}
          />
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {owned && !loading && (
        <div className="mt-6">
          {owned.groups.length === 0 ? (
            <p className="text-sm text-gray-500">
              They host nothing in this co-op, so there is nothing to hand over.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                {owned.total} {owned.total === 1 ? 'event' : 'events'} across{' '}
                {owned.groups.length} {owned.groups.length === 1 ? 'series' : 'series'}.
              </p>

              {/* Coming up first and selected, because that is where a wrong
                  host still costs somebody something. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-gray-100 p-0.5" role="tablist">
                  {(['upcoming', 'past'] as const).map((which) => (
                    <button
                      key={which}
                      type="button"
                      role="tab"
                      aria-selected={tab === which}
                      onClick={() => {
                        setTab(which);
                        setOpen(null);
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        tab === which
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {which === 'upcoming' ? 'Still to come' : 'Finished'}
                      <span className="ml-1.5 tabular-nums text-xs text-gray-400">
                        {split[which].length}
                      </span>
                    </button>
                  ))}
                </div>

                <label className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    aria-hidden="true"
                  />
                  <input
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder="Search these series…"
                    aria-label="Search series"
                    className="input w-full pl-8 text-sm"
                  />
                </label>
              </div>

              {shown.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">
                  {emptyNote(tab, find.trim().length > 0)}
                </p>
              )}

              <ul className="mt-3 divide-y divide-gray-100">
                {shown.map((group) => (
                  <li key={group.title} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{group.title}</p>
                        <p className="mt-0.5 text-sm text-gray-500">
                          {group.total} {group.total === 1 ? 'date' : 'dates'} · {span(group)}
                          {group.upcoming > 0
                            ? ` · ${group.upcoming} still to come`
                            : ' · all in the past'}
                        </p>
                        {/* Said before anything is sent, not discovered after
                            (EVT-15). The preview and the write answer from the
                            same rule. */}
                        {group.blocked.length > 0 && (
                          <p className="mt-1 text-sm text-[var(--danger)]">
                            {group.blocked.length}{' '}
                            {group.blocked.length === 1 ? 'date' : 'dates'} will stay:{' '}
                            {group.blocked[0].reason}
                          </p>
                        )}
                      </div>

                      {open === group.title ? (
                        <button
                          type="button"
                          onClick={() => setOpen(null)}
                          className="btn-ghost text-sm"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(group.title);
                            setNotice(null);
                          }}
                          disabled={busy !== null}
                          className="btn-secondary inline-flex items-center gap-1.5"
                        >
                          Hand over
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {open === group.title && (
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <span className="mb-1 block text-sm font-medium text-gray-900">
                          Who runs {group.title}?
                        </span>
                        <p className="mb-2 text-sm text-gray-500">
                          All {group.total - group.blocked.length}{' '}
                          {group.total - group.blocked.length === 1 ? 'date' : 'dates'}, past
                          ones included — a host with half their own series cannot see what they
                          ran.
                        </p>
                        {busy === group.title ? (
                          <p className="inline-flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Handing them over…
                          </p>
                        ) : (
                          <MemberPicker
                            orgId={orgId}
                            placeholder="Search for the member who runs it…"
                            exclude={from ? [from.user.id] : []}
                            onPick={(member) => hand(group, member)}
                          />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
