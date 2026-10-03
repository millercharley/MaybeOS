'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * How long a member may hold a room, and how much of it (SPC-29).
 *
 * Two settings that look alike and answer different questions. The first is
 * about scheduling — three hours at a time keeps a room circulating. The
 * second is about a member's share of the building, which is a question about
 * fairness and most co-ops never need to ask it, so it is off until somebody
 * turns it on.
 */
const DURATIONS = [60, 90, 120, 180, 240, 360, 480, 720, 1440];

const label = (minutes: number) =>
  minutes % 60 === 0
    ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`
    : `${minutes} minutes`;

export function BookingLimits({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [maxMinutes, setMaxMinutes] = useState(org.maxBookingMinutes ?? 180);
  const [quotaOn, setQuotaOn] = useState(Boolean(org.bookingQuotaPeriod && org.bookingQuotaHours));
  const [period, setPeriod] = useState<'MONTH' | 'YEAR'>(org.bookingQuotaPeriod ?? 'MONTH');
  const [hours, setHours] = useState(String(org.bookingQuotaHours ?? 20));

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api.orgs.update(
        orgId,
        {
          maxBookingMinutes: maxMinutes,
          // Null clears it, which is the switch turned off.
          bookingQuotaPeriod: quotaOn ? period : null,
          bookingQuotaHours: quotaOn ? Math.max(1, Number(hours) || 1) : null,
        },
        token,
      );
      setSaved('Saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <Clock className="h-5 w-5 text-[var(--text-tertiary)]" />
        <h2 className="font-semibold">How long members can book for</h2>
      </div>

      <div className="mt-4">
        <label htmlFor="max-booking" className="block text-sm font-medium text-gray-900">
          Longest single reservation
        </label>
        <select
          id="max-booking"
          value={maxMinutes}
          onChange={(e) => setMaxMinutes(Number(e.target.value))}
          className="input mt-1 w-48"
        >
          {DURATIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {label(minutes)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Nobody can book a room for longer than this at once. A room can set its own
          shorter limit, and the shorter of the two applies.
        </p>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={quotaOn}
            onChange={(e) => setQuotaOn(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block font-medium text-gray-900">
              Limit how much room time one member can hold
            </span>
            <span className="mt-0.5 block text-[var(--text-secondary)]">
              Off unless your co-op needs it. Most do not — this is usually turned on after
              one member has booked the same room every Saturday for a year.
            </span>
          </span>
        </label>

        {quotaOn && (
          <div className="ml-7 mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-700">Up to</span>
            <input
              type="number"
              min="1"
              max="8760"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              aria-label="Hours allowed"
              className="input w-24"
            />
            <span className="text-gray-700">hours per</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as 'MONTH' | 'YEAR')}
              aria-label="Per month or per year"
              className="input w-36"
            >
              <option value="MONTH">month</option>
              <option value="YEAR">year</option>
            </select>
          </div>
        )}

        {quotaOn && (
          <p className="ml-7 mt-2 text-xs text-[var(--text-tertiary)]">
            Counted over the calendar {period === 'MONTH' ? 'month' : 'year'}, so a member can
            say when it resets. Cancelled reservations do not count. Organisers can always
            book on somebody&apos;s behalf.
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-sm text-[var(--success)]">{saved}</span>}
        {error && <span className="text-sm text-[var(--danger)]">{error}</span>}
      </div>
    </div>
  );
}
