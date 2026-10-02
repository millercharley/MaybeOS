'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, type RecapDraft, type RecapSettings, type RecapSummary } from '@/lib/api';
import { money } from '@/lib/pricing-format';
import {
  attendanceLine,
  categoryLabel,
  dayOf,
  duesNote,
  hourLabel,
  monthOf,
  MONEY_SCOPE,
} from '@/lib/recap';
import { PageHeader } from '@/components/layout/page-header';

/**
 * The monthly recap, for the organizer who sends it (RCP-01).
 *
 * This address is in email already sent — the "your recap is ready" nudge
 * links to `/admin/{slug}/recap` — so the route is fixed even if the page
 * moves in the navigation.
 *
 * The order is the order an organizer meets this: the switches they set once,
 * the draft waiting for them, then the ones they have already sent. Sending
 * is the only irreversible act on the page and it is the furthest down the
 * draft, below everything a person would want to read first.
 *
 * What the page is careful about is wording. Every figure the API hands over
 * is honest about what it does not know, and a confident label here would
 * undo that where nobody would notice: attendance that was never counted,
 * money that was taken in cash, a year of dues that MaybeOS only saw half of.
 * The sentences come from `lib/recap.ts` so that a spec can read them.
 */
export default function RecapPage() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [settings, setSettings] = useState<RecapSettings | null>(null);
  const [draft, setDraft] = useState<RecapDraft | null>(null);
  const [history, setHistory] = useState<RecapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Asked in the page rather than by `window.confirm` — see `send`.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) {
      setLoading(false);
      return;
    }
    try {
      const [s, latest, list] = await Promise.all([
        api.recap.settings(orgId, token),
        api.recap.latest(orgId, token),
        api.recap.list(orgId, token),
      ]);
      setSettings(s);
      setDraft(latest);
      setHistory(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this');
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  // The textarea follows whichever draft is on screen. Without this, sending
  // or drafting — both of which reload — would leave the box holding the
  // previous recap's note, and saving it would write it onto this one.
  useEffect(() => {
    setNote(draft?.note ?? '');
  }, [draft?.id, draft?.note]);

  const saveSettings = async (changes: Parameters<typeof api.recap.updateSettings>[1]) => {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setSettings(await api.recap.updateSettings(orgId, changes, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!token || !orgId || !draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setDraft(await api.recap.setNote(orgId, draft.id, note, token));
      setNotice('Your note is saved. It has not been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The one action that writes to every member's inbox, and it cannot be
   * taken back — so the confirmation says how many people it reaches rather
   * than asking "are you sure" about a number nobody has in their head.
   *
   * Asked in the page rather than with `window.confirm`, which the rest of
   * the admin uses for ordinary deletes. Two reasons this one is different.
   * A browser that suppresses dialogs — some do, and some let a person tick
   * "don't show me these again" — turns `confirm` into a silent false, so an
   * organizer presses Send, nothing happens, and nothing explains why; that
   * is exactly how this was found. And this is the highest-stakes button in
   * the product, so it deserves the co-op's own words and the number of
   * people, in the shape the join page already uses for opening a co-op to
   * strangers.
   */
  const send = async () => {
    if (!token || !orgId || !draft || !settings) return;
    setConfirming(false);

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { sent } = await api.recap.send(orgId, draft.id, token);
      setNotice(`Sent to ${sent} member${sent === 1 ? '' : 's'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send');
    } finally {
      setBusy(false);
    }
  };

  const draftNow = async () => {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await api.recap.draft(orgId, token);
      // Null means the month was not worth a letter, or was drafted already.
      // Both are fine outcomes and neither is an error, so neither gets a red
      // box — an organizer who presses this deserves to know which it was.
      if (!next) {
        setNotice(
          'Nothing to draft. Either last month already has a recap, or nothing ' +
            'happened in it worth sending a letter about.',
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Monthly recap" />
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Could not load this'}
        </p>
      </div>
    );
  }

  const timeZone = settings.timezone;
  const sent = draft?.status === 'SENT';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly recap"
        description="On the 1st, MaybeOS writes up the month your co-op just had. You read it, add anything in your own words, and send it."
      />

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700" role="status">
          {notice}
        </p>
      )}

      <section className="card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Drafting</h2>
            <p className="mt-1 max-w-prose text-sm text-gray-500">
              Nothing is ever sent for you. MaybeOS drafts the month and emails your
              organizers that it is waiting; it goes to members when somebody presses send.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              settings.enabled && settings.available
                ? 'bg-green-50 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {settings.enabled && settings.available ? 'On' : 'Off'}
          </span>
        </div>

        {/*
          The upgrade path, stated once and without nagging. The switch stays
          on screen and disabled rather than disappearing, so an organizer can
          see what they would be turning on.
        */}
        {!settings.available && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The monthly recap is part of Plus and Unlimited. Upgrade in Billing and MaybeOS
            will start writing up your co-op&rsquo;s month on the 1st.
          </div>
        )}

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy || !settings.available}
            onChange={(e) => saveSettings({ enabled: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm text-gray-700">
            Draft a recap each month
            <span className="block text-gray-500">
              Every member can turn their own copy off, and every recap says how.
            </span>
          </span>
        </label>

        {settings.enabled && settings.available && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-700">
              <span className="block font-medium">Drafted on the 1st at</span>
              <select
                value={settings.draftHour}
                disabled={busy}
                onChange={(e) => saveSettings({ draftHour: Number(e.target.value) })}
                className="input mt-1 w-auto"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-sm text-gray-500">
              {timeZone}, your community&rsquo;s own time. {settings.subscribed} member
              {settings.subscribed === 1 ? '' : 's'} would get it.
            </p>
          </div>
        )}

        <label className="flex items-start gap-3 border-t border-gray-100 pt-5">
          <input
            type="checkbox"
            checked={settings.showMoney}
            disabled={busy || !settings.available}
            onChange={(e) => saveSettings({ showMoney: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm text-gray-700">
            Show members what the co-op took
            <span className="block text-gray-500">
              {MONEY_SCOPE} Off means no money figures in the email at all. You still see
              them here.
            </span>
          </span>
        </label>
      </section>

      {draft ? (
        <section className="card space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {draft.figures.monthLabel}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {sent && draft.sentAt
                  ? `Sent ${dayOf(draft.sentAt, timeZone)} to ${draft.sentCount} member${
                      draft.sentCount === 1 ? '' : 's'
                    }.`
                  : 'Not sent. Nobody has seen this but your organizers.'}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                sent ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {sent ? 'Sent' : 'Draft'}
            </span>
          </div>

          <Figures draft={draft} timeZone={timeZone} />

          {draft.composed && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                The paragraph at the top
              </h3>
              <p className="mt-2 text-sm text-gray-700">{draft.composed}</p>
            </div>
          )}

          {/*
            Why there is no paragraph, where there is a reason. The API records
            one on the row precisely so an organizer is not left wondering
            whether something is still coming.
          */}
          {!draft.composed && draft.composeNote && (
            <p className="text-sm text-gray-500">
              No paragraph was written: {draft.composeNote}. The figures and your own note
              go out without one.
            </p>
          )}

          <div className="border-t border-gray-100 pt-5">
            <h3 className="text-sm font-semibold text-gray-900">Your note</h3>
            <p className="mt-1 max-w-prose text-sm text-gray-500">
              Goes at the very top, in your words, above everything MaybeOS counted. The
              thing members actually read. Optional.
            </p>

            {sent ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
                {draft.note || 'You sent this one without a note.'}
              </p>
            ) : (
              <>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  placeholder="Anything you want your members to know about the month."
                  className="input mt-3 w-full text-sm"
                  aria-label="Your note"
                />
                {/* An explicit Save, not blur-to-save: the admin screens lost
                    edits that way once already (ONB-01). */}
                {note !== (draft.note ?? '') && (
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={busy}
                    className="btn-secondary mt-3 text-sm"
                  >
                    Save this note
                  </button>
                )}
              </>
            )}
          </div>

          {confirming && !sent && settings && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                This goes to {settings.subscribed} member
                {settings.subscribed === 1 ? '' : 's'} straight away, and it cannot be unsent or
                edited afterwards.{' '}
                {draft?.note ? 'Your note goes with it.' : 'You have not added a note.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={send} disabled={busy} className="btn-primary text-sm">
                  {busy ? 'Sending…' : `Yes, send it to ${settings.subscribed}`}
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
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
            {sent ? (
              <>
                <p className="min-w-0 flex-1 text-sm text-gray-500">
                  A recap that has gone out cannot be changed or unsent. The next one is
                  drafted on the 1st.
                </p>
                {/*
                  Also here, not only on the empty state. A co-op that turned
                  drafting on after the 1st would otherwise be looking at a
                  sent recap with no way to write up the month since.
                */}
                <button
                  type="button"
                  onClick={draftNow}
                  disabled={busy || !settings.available}
                  className="btn-secondary shrink-0 text-sm"
                >
                  Write up last month now
                </button>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-sm text-gray-500">
                  Goes to {settings.subscribed} member
                  {settings.subscribed === 1 ? '' : 's'} — everybody who has not turned these
                  emails off. It cannot be unsent or edited afterwards.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy || !settings.available || confirming}
                  className="btn-primary shrink-0 text-sm"
                >
                  Send to members
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <h2 className="text-base font-semibold text-gray-900">No recap yet</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            The next one is drafted on the 1st. You can write up last month now instead —
            nothing is sent either way.
          </p>
          <button
            type="button"
            onClick={draftNow}
            disabled={busy || !settings.available}
            className="btn-secondary mt-4 text-sm"
          >
            Write up last month now
          </button>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <h2 className="text-base font-semibold text-gray-900">Every recap</h2>
          <ul className="mt-4 space-y-2">
            {history.map((recap) => (
              <li
                key={recap.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-2 text-sm last:border-0"
              >
                <span className="text-gray-900">{monthOf(recap.periodStart, timeZone)}</span>
                <span className="text-gray-500">
                  {recap.status === 'SENT' && recap.sentAt
                    ? `Sent ${dayOf(recap.sentAt, timeZone)} to ${recap.sentCount} member${
                        recap.sentCount === 1 ? '' : 's'
                      }`
                    : 'Not sent'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Every figure the recap states, each one labelled as what it is.
 *
 * Money is shown to the organizer whether or not members see it — they can
 * read it everywhere else in the app, and deciding what to tell members is
 * the point of the switch above. The page says which way the switch is set
 * rather than hiding the numbers from the person setting it.
 */
function Figures({ draft, timeZone }: { draft: RecapDraft; timeZone: string }) {
  const f = draft.figures;
  const attendance = attendanceLine(f.events);
  const dues = duesNote(f, timeZone);

  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label="Members now" value={String(f.members.total)} />
        <Figure
          label="Joined this month"
          value={String(f.members.joined)}
          note="People who joined. MaybeOS keeps no record of anybody leaving, so this is not net growth."
        />
        <Figure label="Events held" value={String(f.events.hosted)} />

        {attendance && (
          <Figure
            label={attendance.label}
            value={String(attendance.value)}
            note={attendance.caveat ?? undefined}
          />
        )}

        {f.service && (
          <Figure
            label="Hours members served"
            value={`${f.service.hours} by ${f.service.members} ${
              f.service.members === 1 ? 'person' : 'people'
            }`}
            note={
              f.service.valueCents
                ? `Worth ${money(f.service.valueCents)} at the rate your co-op set.`
                : undefined
            }
          />
        )}

        <Figure label="Taken through MaybeOS" value={money(f.money.month.totalCents)} />
        <Figure
          label="So far this year"
          value={money(f.money.year.totalCents)}
          note={dues ?? undefined}
        />
      </dl>

      <p className="max-w-prose text-sm text-gray-500">
        {MONEY_SCOPE}{' '}
        {draft.showMoney
          ? 'Members see the two money figures.'
          : 'Members see neither money figure — the switch above is off.'}
      </p>

      {f.impact.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900">What members are telling you</h3>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            All time rather than this month, and only where at least five people answered. A
            single month almost never clears that floor, and a score that vanished in a quiet
            month would read as a collapse.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {f.impact.map((measure) => (
              <li key={measure.category} className="flex flex-wrap justify-between gap-3">
                <span className="text-gray-700">{categoryLabel(measure.category)}</span>
                <span className="text-gray-900">
                  {measure.average} out of 5
                  <span className="ml-2 text-gray-500">
                    {measure.respondents} member{measure.respondents === 1 ? '' : 's'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-gray-900">{value}</dd>
      {note && <p className="mt-2 text-xs text-gray-500">{note}</p>}
    </div>
  );
}
