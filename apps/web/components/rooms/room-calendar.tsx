'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calendar, Check, RefreshCw } from 'lucide-react';
import { api, ApiError, type Room } from '@/lib/api';
import { calendarState } from '@/lib/room-calendar';

/**
 * A room's Google Calendar: connect, choose which calendar, disconnect.
 *
 * Connecting and choosing are two different things, and the product used to
 * treat them as one. `googleCalendarId` was never set by anything, so all five
 * places that read it fell through to `'primary'` — the personal calendar of
 * whichever organiser happened to click Connect. Their dentist appointment
 * would have blocked the Attic, and the Attic's bookings would have turned up
 * in their own diary. So "connected" is deliberately not the end of the flow
 * here: it asks which calendar, and keeps asking until somebody answers.
 */
export function RoomCalendar({
  room,
  orgId,
  token,
  onChange,
}: {
  room: Room;
  orgId: string;
  token: string;
  onChange: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [choices, setChoices] = useState<
    { id: string; name: string; primary: boolean }[] | null
  >(null);
  const [account, setAccount] = useState<string | null>(room.googleAccountEmail ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Connected means we hold a token, which the room reports as an account
  // address; chosen means a calendar id. A room can be the first without being
  // the second, and that gap is the whole point of this component.
  const state = calendarState(room);
  const connected = state !== 'disconnected';
  const chosen = state === 'syncing';

  const loadChoices = useCallback(async () => {
    setError('');
    try {
      const res = await api.calendar.listCalendars(orgId, room.id, token);
      setChoices(res.calendars);
      setAccount(res.account ?? null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not read the calendars on that account.',
      );
    }
  }, [orgId, room.id, token]);

  // Fetched as soon as a room is connected but unchosen, so the admin lands on
  // a list rather than on another button to press.
  useEffect(() => {
    if (connected && !chosen) loadChoices();
  }, [connected, chosen, loadChoices]);

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      const { url } = await api.calendar.connectRoom(orgId, room.id, token);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the Google connection.');
      setConnecting(false);
    }
  }

  async function choose(calendarId: string) {
    if (!calendarId) return;
    setSaving(true);
    setError('');
    try {
      await api.calendar.selectCalendar(orgId, room.id, calendarId, token);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that choice.');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    // Nothing is deleted from Google: those entries are the co-op's record of
    // what was booked, and this button is not allowed to clear somebody's
    // calendar. Said out loud, because the opposite is a fair guess.
    if (
      !window.confirm(
        `Stop syncing ${room.name} with Google Calendar? Bookings already on the calendar stay there.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.calendar.disconnectRoom(orgId, room.id, token);
      setChoices(null);
      setAccount(null);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setSaving(false);
    }
  }

  if (!connected) {
    return (
      <div>
        <button onClick={connect} disabled={connecting} className="btn-secondary">
          {connecting ? 'Opening Google…' : 'Connect calendar'}
        </button>
        {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    // `min-w-0` so a long calendar name or account address can shrink the
    // panel rather than push it off a phone. Found on production: dev has no
    // room with a calendar connected, so this whole panel never rendered
    // there (UI-01).
    <div className="w-full min-w-0 max-w-sm text-sm">
      {chosen ? (
        <p className="flex items-start gap-2 text-[var(--text-secondary)]">
          <Check size={14} className="mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
          {/* `break-words`: a calendar id is one unbroken 40-character token
              and an email address nearly so, and neither has a space to wrap
              at. */}
          <span className="min-w-0 break-words">
            Syncing to <strong>{room.googleCalendarName ?? room.googleCalendarId}</strong>
            {account ? <span className="text-[var(--text-tertiary)]"> · {account}</span> : null}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-[var(--text-secondary)]">
          <Calendar size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Connected{account ? ` as ${account}` : ''}. Choose which calendar this room uses.
          </span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label={`Calendar for ${room.name}`}
          className="input flex-1"
          disabled={saving || !choices}
          value={room.googleCalendarId ?? ''}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{choices ? 'Choose a calendar…' : 'Loading calendars…'}</option>
          {choices?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.primary ? ' (personal)' : ''}
            </option>
          ))}
        </select>

        <button
          onClick={loadChoices}
          disabled={saving}
          className="btn-ghost"
          title="Reload the list from Google"
          aria-label="Reload the list from Google"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>

        <button onClick={disconnect} disabled={saving} className="btn-ghost text-xs">
          Disconnect
        </button>
      </div>

      {choices?.length === 0 && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          That account has no calendars it can write to. A calendar shared with it read-only
          cannot hold bookings.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
