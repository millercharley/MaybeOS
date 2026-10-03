'use client';

import Link from 'next/link';
import { HandHelping, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { api, type MyService } from '@/lib/api';
import { formatMinutes, servingToday, timeOf } from '@/lib/service-rota';

/**
 * "You're serving today" (SRV-04).
 *
 * Charley took the Saturday watering, saw it confirmed in Serve, and then found
 * nothing on the day that said so: "Also need email reminders the morning of
 * the date, plus a reminder on the Dashboard." This is the dashboard half.
 *
 * It renders **nothing** on a day nobody is serving, which is most days for
 * most members — a panel reading "no duties today" on 360 mornings a year is
 * furniture, and the one morning it matters it would look the same as always.
 *
 * Today is the co-op's today: at ten at night in California, a turn at the
 * building in New York is tomorrow.
 */
export function ServingToday({ orgId, orgSlug }: { orgId?: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<MyService | null>(null);

  /*
    The co-op named in the URL, not whichever one the session last switched to:
    a member of two co-ops reading one portal must not be told about a turn at
    the other. That is why this takes an orgId rather than reaching for the
    store's current one.

    A quiet failure. This is a reminder on somebody's home screen, and an error
    banner where it would have been is worse than nothing.
  */
  useEffect(() => {
    if (!orgId || !token) return;
    let live = true;
    api.service
      .mine(orgId, token)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [orgId, token]);

  if (!data) return null;

  const mine = servingToday(data.upcoming ?? [], data.timezone, new Date());
  if (mine.length === 0) return null;

  return (
    <section
      aria-label="Serving today"
      className="rounded-2xl border border-brand-300 bg-brand-50 p-5"
    >
      <p className="inline-flex items-center gap-2 font-semibold text-gray-900">
        <HandHelping className="h-4 w-4" aria-hidden="true" />
        {mine.length === 1 ? "You're serving today" : `You're serving ${mine.length} turns today`}
      </p>

      <ul className="mt-2 space-y-1">
        {mine.map((claim) => (
          <li key={claim.id} className="text-sm">
            <span className="font-medium">{claim.duty?.title}</span>
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {timeOf(claim.occursAt, data.timezone)}
              {claim.duty?.estimatedMinutes
                ? ` · ${formatMinutes(claim.duty.estimatedMinutes)}`
                : ''}
            </span>
            {claim.status === 'CLAIMED' && (
              <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                waiting on an organizer
              </span>
            )}
          </li>
        ))}
      </ul>

      <Link
        href={`/member/${orgSlug}/service`}
        className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        See what you are serving
      </Link>
    </section>
  );
}
