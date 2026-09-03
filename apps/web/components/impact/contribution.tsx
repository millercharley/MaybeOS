'use client';

import Link from 'next/link';
import { HandHelping } from 'lucide-react';
import type { ServiceContribution } from '@/lib/api';
import { money } from '@/lib/fees';

/**
 * What members gave, on the Measuring page (SRV-02).
 *
 * The hours lead and the money follows, because hours are a fact and the
 * dollar figure is the co-op's own assertion. Where the rate is unset, this
 * says so and offers to fix it rather than silently reporting a smaller
 * story — an organiser writing a funding application needs to know the number
 * is available, not discover its absence in the report.
 */
export function ContributionCard({
  gave,
  orgSlug,
}: {
  gave: ServiceContribution | null;
  orgSlug: string;
}) {
  // Nothing served: no card. A "0 hours" panel on a co-op with no rota reads
  // as members who did nothing rather than a feature nobody has used.
  if (!gave || gave.totalMinutes <= 0) return null;

  const valued = gave.valueCents !== null && gave.hourValueCents !== null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="flex items-center gap-2 font-medium text-gray-900">
        <HandHelping className="h-4 w-4 text-gray-400" />
        What members gave
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <span>
          <span className="text-2xl font-semibold text-gray-900">{gave.totalHours}</span>
          <span className="ml-1 text-sm text-gray-500">
            {gave.totalHours === 1 ? 'hour' : 'hours'}
          </span>
        </span>
        <span className="text-sm text-gray-500">
          {gave.members} {gave.members === 1 ? 'member' : 'members'} · {gave.turns}{' '}
          {gave.turns === 1 ? 'turn' : 'turns'}
        </span>
        {valued && (
          <span className="text-sm text-gray-500">
            {money(gave.valueCents!)} at {money(gave.hourValueCents!)} an hour
          </span>
        )}
      </div>

      {!valued ? (
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
          Your impact report will state these hours. To put a figure on them, set what
          your co-op values an hour of service at under{' '}
          <Link href={`/admin/${orgSlug}/settings`} className="underline">
            Settings
          </Link>
          . MaybeOS will not choose a rate for you — it is a number your co-op asserts,
          and a funder may ask where it came from.
        </p>
      ) : (
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
          Only turns a member marked done are counted, on the day the turn fell.{' '}
          {gave.correctedTurns > 0
            ? `${gave.correctedTurns} of ${gave.turns} were corrected by the member from your estimate.`
            : 'Every figure is your own estimate of what a turn takes.'}
        </p>
      )}
    </section>
  );
}
