'use client';

import { useEffect, useState } from 'react';
import { api, WEEKLY_CTA_LIMIT, type SocialStatus, type WeeklyPostSettings } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

const hourLabel = (hour: number) => {
  if (hour === 0) return '12 am';
  if (hour === 12) return '12 pm';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
};

/** Thursday + 11 days reaches the following Sunday; say so rather than make them count. */
function spanWords(day: number, days: number): string {
  const name = (n: number) => DAYS[((n - 1) % 7 + 7) % 7].label;
  return days === 1 ? name(day) : `${name(day)} through the following ${name(day + days - 1)}`;
}

/**
 * The co-op's weekly post to Facebook and Instagram (SOC-05).
 *
 * Charley: "have the MaybeOS system allow an admin to connect to their
 * Instagram account and/or Facebook Page to generate a weekly post to
 * highlight public events happening at the co-op… Allow the Admin to set
 * their time preference of when the post will be sent."
 *
 * Sits below the connection card and only appears once a Page is connected:
 * there is nothing to schedule without one, and a form that saves into
 * nowhere is worse than no form.
 */
export function WeeklyPost({ status, onChange }: { status: SocialStatus; onChange: (next: SocialStatus) => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cta, setCta] = useState('');

  const weekly: WeeklyPostSettings | null = status.weekly;

  useEffect(() => {
    setCta(weekly?.cta ?? '');
  }, [weekly?.cta]);

  if (!weekly || !token || !orgId) return null;

  async function save(patch: Parameters<typeof api.social.updateWeekly>[1]) {
    if (!token || !orgId) return;
    setBusy(true);
    setError('');
    try {
      onChange(await api.social.updateWeekly(orgId, patch, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  const last = weekly.last;

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">A weekly post of what&apos;s on</h2>
          <p className="mt-1 text-sm text-gray-500">
            One image listing your public events, with the details in the caption. MaybeOS posts it
            for you.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weekly.enabled}
            disabled={busy}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <span className="font-medium text-gray-900">{weekly.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-900">Posts on</span>
          <select
            value={weekly.day}
            disabled={busy}
            onChange={(e) => save({ day: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-900">At</span>
          <select
            value={weekly.hour}
            disabled={busy}
            onChange={(e) => save({ hour: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          {/* The hour is the co-op's own, not the reader's — the same rule
              booking emails follow (SPC-08). */}
          <span className="mt-1 block text-xs text-gray-500">Your co-op&apos;s own time</span>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-gray-900">Covering</span>
          <select
            value={weekly.days}
            disabled={busy}
            onChange={(e) => save({ days: Number(e.target.value) })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {[7, 11, 14, 21, 28].map((d) => (
              <option key={d} value={d}>
                {d} days — {spanWords(weekly.day, d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <label htmlFor="weekly-cta" className="block text-sm font-medium text-gray-900">
          What the image asks people to do
        </label>
        <input
          id="weekly-cta"
          type="text"
          value={cta}
          maxLength={WEEKLY_CTA_LIMIT}
          disabled={busy}
          onChange={(e) => setCta(e.target.value)}
          onBlur={() => cta !== (weekly.cta ?? '') && save({ cta })}
          placeholder="Visit example.com/events for tickets and details!"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-500">
          {cta.length}/{WEEKLY_CTA_LIMIT} characters. It goes along the bottom of the image, so it
          has to be short enough to read at a glance.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weekly.toPage}
            disabled={busy}
            onChange={(e) => save({ toPage: e.target.checked })}
          />
          <span>Facebook Page</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weekly.toInstagram}
            disabled={busy}
            onChange={(e) => save({ toInstagram: e.target.checked })}
          />
          <span>Instagram</span>
        </label>
      </div>

      {/*
        What happened last time.

        Something that posts once a week is something an admin otherwise has
        no way to check without opening Instagram — and a failure that is
        only visible there is a failure nobody acts on.
      */}
      {last && (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {last.status === 'PUBLISHED' && (
            <>
              Last posted {last.periodStart} · {last.eventCount}{' '}
              {last.eventCount === 1 ? 'event' : 'events'}
              {last.facebookUrl && (
                <>
                  {' · '}
                  <a href={last.facebookUrl} className="underline" target="_blank" rel="noreferrer">
                    Facebook
                  </a>
                </>
              )}
              {last.instagramUrl && (
                <>
                  {' · '}
                  <a href={last.instagramUrl} className="underline" target="_blank" rel="noreferrer">
                    Instagram
                  </a>
                </>
              )}
            </>
          )}
          {last.status === 'EMPTY' && (
            <>Nothing public was on for {last.periodStart}, so nothing was posted.</>
          )}
          {last.status === 'FAILED' && (
            <span className="text-red-700">
              The post for {last.periodStart} did not go out. {last.error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
