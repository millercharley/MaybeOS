'use client';

import { useEffect, useState } from 'react';
import { CalendarImportSummary, ImportableCalendar, Org, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  DEFAULT_MONTHS_BACK,
  MONTHS_BACK_CHOICES,
  calendarNote,
  confirmationLine,
  isSelectable,
  kindLabel,
  MAX_REQUESTS,
  mergeSummaries,
  selectableCalendars,
  summaryLine,
} from '@/lib/calendar-import';

/**
 * Bringing a co-op's Google calendars into MaybeOS (CAL-02).
 *
 * The sibling of `sign-in-links.tsx`, and for the same reason: this is a bulk
 * action a migration runs once, in front of a whole community, and it cannot be
 * un-run by pressing something. So it looks before it writes — preview is the
 * first button, the real import is behind a confirmation that states the
 * number, and the number comes from the preview the admin is looking at.
 *
 * **Two kinds of calendar, and the difference is the whole feature.** A room's
 * own calendar is reservations: holds, maintenance, somebody's rehearsal. Those
 * become bookings, so the rooms page is honest about what is free and no
 * member is ever invited to attend "DO NOT BOOK — floor sealing". One chosen
 * calendar holds what the community is meant to see, and only that one becomes
 * events. The picker refuses a room's calendar rather than letting the admin
 * find out from a failed request.
 */
export function CalendarImport({ org }: { org: Org }) {
  const token = useAuthStore((s) => s.token);
  const [calendars, setCalendars] = useState<ImportableCalendar[] | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  /**
   * The API's own sentence when no room here has a Google account connected.
   * Shown verbatim: it names the thing that is missing, which "Something went
   * wrong" would hide behind a retry nobody can make succeed.
   */
  const [unavailable, setUnavailable] = useState('');
  const [preview, setPreview] = useState<CalendarImportSummary | null>(null);
  const [result, setResult] = useState<CalendarImportSummary | null>(null);
  const [monthsBack, setMonthsBack] = useState(DEFAULT_MONTHS_BACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.calendar
      .importableCalendars(org.id, token)
      .then((list) => {
        setCalendars(list);
        setChosenId(list.find((c) => c.selected)?.id ?? null);
        setUnavailable('');
      })
      .catch((err) =>
        setUnavailable(
          err instanceof Error ? err.message : 'Could not read this community’s calendars',
        ),
      );
  }, [org.id, token]);

  async function choose(calendarId: string | null) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.calendar.selectEventsCalendar(org.id, calendarId, token);
      setChosenId(calendarId);
      // A preview of the previous choice reads as a preview of this one, and
      // the whole point of the preview is that the number can be trusted.
      setPreview(null);
      setResult(null);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That calendar could not be chosen');
    } finally {
      setBusy(false);
    }
  }

  async function look() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setPreview(await api.calendar.runImport(org.id, { dryRun: true, monthsBack }, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Run the import, in as many requests as it takes (CAL-05).
   *
   * One request could not finish it: nine calendars and a year of entries
   * exceed a Lambda's ten seconds, and the first real attempt returned 504
   * with nothing to show for the work it had already done. The API now stops
   * when it is nearly out of time and says where it got to; this keeps
   * asking, and shows the running total rather than a spinner that either
   * finishes or does not.
   */
  async function importNow() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setConfirming(false);

    let total: CalendarImportSummary | null = null;
    let resumeFrom: { calendar: number; entry: number } | null = null;

    try {
      // Bounded, because a server answering with the same cursor every time
      // would otherwise have the browser ask forever.
      for (let request = 0; request < MAX_REQUESTS; request++) {
        const chunk = await api.calendar.runImport(
          org.id,
          { dryRun: false, monthsBack, ...(resumeFrom && { resumeFrom }) },
          token,
        );

        total = mergeSummaries(total, chunk);
        setResult(total);

        if (!chunk.next) return;
        resumeFrom = chunk.next;
      }

      setError(
        'The import is taking more requests than expected. Everything below is already imported — press Import again to carry on from here.',
      );
    } catch (err) {
      // Whatever was written stays written, and a re-run is an upsert, so the
      // honest instruction is "press it again".
      setError(
        `${err instanceof Error ? err.message : 'That did not import'}${
          total ? ' — everything below was imported. Press Import again to carry on.' : ''
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  // The result once there is one, because that is what was actually written.
  const shown = result ?? preview;
  const chosenName = calendars?.find((c) => c.id === chosenId)?.name ?? null;
  const roomsOnly = calendars !== null && selectableCalendars(calendars).length === 0;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">
          Import your existing Google calendars
        </h2>
        <p className="mt-1 max-w-prose text-sm text-gray-500">
          A co-op that has been running on Google Calendar for years has two different
          things in there. Each room&rsquo;s own calendar is <strong>reservations</strong> —
          holds, maintenance, somebody&rsquo;s rehearsal — and those come in as room bookings,
          so the rooms page is honest about what is free. One calendar holds the gatherings
          members are meant to come to, and only that one becomes events.
        </p>
        <p className="mt-2 max-w-prose text-sm text-gray-500">
          Imported events are visible to <strong>everyone with a membership, and not to the
          public</strong>. Nobody is emailed and nothing is announced. Run it again as often as
          you like: every entry remembers where in Google it came from, so a second run updates
          what it brought over rather than importing it twice.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {unavailable} Connect one of your rooms to the Google account that holds these
          calendars, on the Rooms page, and this will be able to read all of them.
        </div>
      ) : calendars === null ? (
        <p className="text-sm text-gray-500">Reading your calendars&hellip;</p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Which calendar holds your events?
            </h3>
            <p className="mt-1 max-w-prose text-sm text-gray-500">
              MaybeItsFate&rsquo;s is &ldquo;MaybeItsFate Main Events&rdquo;. A room&rsquo;s own
              calendar can&rsquo;t be chosen here — that one is reservations, and importing every
              hold as an event would put &ldquo;DO NOT BOOK&rdquo; in front of your whole
              community.
            </p>

            {roomsOnly && (
              <p className="mt-2 max-w-prose text-sm text-amber-800">
                Every calendar this account can read already belongs to one of your rooms. Share
                your events calendar with that Google account and it will appear here.
              </p>
            )}

            <ul className="mt-3 space-y-1">
              {calendars.map((calendar) => {
                const note = calendarNote(calendar);
                const selectable = isSelectable(calendar);

                return (
                  <li key={calendar.id}>
                    <label
                      className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${
                        selectable ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed'
                      }`}
                    >
                      <input
                        type="radio"
                        name="events-calendar"
                        checked={chosenId === calendar.id}
                        disabled={busy || !selectable}
                        onChange={() => choose(calendar.id)}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <span className={selectable ? 'text-gray-900' : 'text-gray-400'}>
                          {calendar.name}
                        </span>
                        {note && <span className="block text-gray-500">{note}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}

              {/* Clearing it is how an admin says "rooms only" — a co-op whose
                  events live somewhere other than Google still wants its
                  reservations, and nothing else offers that. */}
              <li>
                <label className="flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <input
                    type="radio"
                    name="events-calendar"
                    checked={chosenId === null}
                    disabled={busy}
                    onChange={() => choose(null)}
                    className="mt-1"
                  />
                  <span className="text-sm text-gray-900">
                    None of these
                    <span className="block text-gray-500">
                      Bring in room reservations only, and no events at all.
                    </span>
                  </span>
                </label>
              </li>
            </ul>

            {chosenName && (
              <p className="mt-2 text-sm text-gray-500">
                Events will come from <strong>{chosenName}</strong>.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
            <label className="text-sm text-gray-700">
              <span className="block font-medium">How far back to reach</span>
              <select
                value={monthsBack}
                disabled={busy}
                onChange={(e) => {
                  setMonthsBack(Number(e.target.value));
                  // Same reason as changing the calendar: the numbers below
                  // were counted over a different window.
                  setPreview(null);
                  setResult(null);
                  setConfirming(false);
                }}
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2"
              >
                {MONTHS_BACK_CHOICES.map((choice) => (
                  <option key={choice.months} value={choice.months}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-prose text-sm text-gray-500">
              Anything up to two years ahead comes across whatever you pick here.
            </p>
          </div>

          {shown && (
            <div className="rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Calendar</th>
                    <th className="px-3 py-2 font-medium">Becomes</th>
                    <th className="px-3 py-2 text-right font-medium">Found</th>
                    {!shown.dryRun && (
                      <th className="px-3 py-2 text-right font-medium">Written</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.calendars.map((row) => (
                    <tr key={row.id} className="border-b border-gray-50 last:border-0">
                      {/* The API calls the events row "Events" because it
                          carries the calendar's id, not its title. The screen
                          knows the title, and an admin checking this table is
                          checking that it read the calendar they meant. */}
                      <td className="px-3 py-2 text-gray-900">
                        {row.kind === 'events' ? chosenName ?? row.name : row.name}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {kindLabel(row.kind)}
                        {/* Why this one produced nothing, where that needs
                            saying — a room that shares the events calendar,
                            or one Google would not answer for. */}
                        {row.note && <span className="block text-xs text-gray-400">{row.note}</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">{row.found}</td>
                      {!shown.dryRun && (
                        <td className="px-3 py-2 text-right text-gray-900">{row.written}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Only when there were some. A permanent "0 skipped" is noise;
                  a number here is the interesting case, and it is usually
                  cancelled entries rather than anything wrong. */}
              {shown.skipped > 0 && (
                <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  {shown.skipped} {shown.skipped === 1 ? 'entry was' : 'entries were'} left out —
                  cancelled, or with no usable date.
                </p>
              )}
            </div>
          )}

          {result ? (
            <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
              {summaryLine(result)}
            </div>
          ) : preview ? (
            <p className="max-w-prose text-sm text-gray-600">{summaryLine(preview)}</p>
          ) : null}

          {preview === null && result === null ? (
            <button type="button" onClick={look} disabled={busy} className="btn-primary text-sm">
              {busy ? 'Looking…' : 'Preview what this would import'}
            </button>
          ) : confirming && preview ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">{confirmationLine(preview)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={importNow}
                  disabled={busy}
                  className="btn-primary text-sm"
                >
                  {busy ? 'Importing…' : 'Yes, import now'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="btn-secondary text-sm"
                >
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {preview && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  className="btn-primary text-sm"
                >
                  {result ? 'Import again' : 'Import for real'}
                </button>
              )}
              <button type="button" onClick={look} disabled={busy} className="btn-secondary text-sm">
                {busy ? 'Looking…' : 'Preview again'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
