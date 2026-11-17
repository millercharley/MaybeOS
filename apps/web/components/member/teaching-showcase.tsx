'use client';

import Link from 'next/link';
import { ChevronRight, GraduationCap, Users } from 'lucide-react';
import { Panel } from '@/components/layout/panel';
import { useApi } from '@/hooks/use-api';
import { api, type Offering } from '@/lib/api';
import { priceLabel, scheduleLabel, showcaseOfferings } from '@/lib/teaching';

/**
 * What people here are teaching, on a member's dashboard (TCH-03).
 *
 * Charley asked for it: the dashboard should showcase teaching offerings.
 * The point is discovery — a member who has never opened the Teaching page
 * does not know anybody is offering anything, and a workshop gathering
 * interest needs people to find it before it has dates to advertise.
 *
 * **The whole co-op's, not this member's own.** `My Teaching` already answers
 * "what am I running"; this answers "what could I go to". A member who
 * teaches will see their own here too, which is right — it is what everybody
 * else sees, from the same list.
 *
 * Draws nothing at all when the co-op does not run teaching, so it costs the
 * other co-ops on MaybeOS a panel of empty space rather than nothing.
 */
export function TeachingShowcase({
  orgSlug,
  enabled,
}: {
  orgSlug: string;
  enabled?: boolean;
}) {
  /*
    Asked for only when the feature is on. `useApi` is called either way,
    because a hook cannot be skipped — the request itself is what is
    conditional, and `null` means "do not fetch".
  */
  const { data, loading } = useApi(
    (token, orgId) => (enabled ? api.teaching.list(orgId, token) : Promise.resolve([])),
    [enabled],
  );

  if (!enabled) return null;

  const shown = showcaseOfferings(data ?? []);

  return (
    <Panel
      title="What people here are teaching"
      actions={
        <Link
          href={`/portal/${orgSlug}/teaching`}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          See all
        </Link>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      ) : shown.length === 0 ? (
        /*
          Says what would make it fill up, rather than apologising for being
          empty (DESIGN §7). The co-op that has nobody teaching yet is one
          where somebody reading this is the likeliest first teacher.
        */
        <div className="py-6 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">Nobody is teaching anything just yet.</p>
          <Link
            href={`/member/${orgSlug}/teaching`}
            className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Offer something yourself
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((offering) => (
            <li key={offering.id}>
              <OfferingRow offering={offering} orgSlug={orgSlug} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One offering, in a row the dashboard's other panels would recognise.
 *
 * The same shape as My Upcoming Events and My Bookings — a bordered row, the
 * name, one line under it, a chevron — rather than the teaching page's card.
 * A dashboard that renders the same kind of thing four different ways reads
 * as four different products.
 */
function OfferingRow({ offering, orgSlug }: { offering: Offering; orgSlug: string }) {
  const Icon = offering.kind === 'WORKSHOP' ? Users : GraduationCap;

  return (
    <Link
      href={`/portal/${orgSlug}/teaching/${offering.slug}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-brand-300"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">
          {offering.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {/*
            The teacher's name, which is most of why somebody reads one of
            these. Never their address — that is the whole reason interest is
            registered in the product rather than by email (TCH-01).
          */}
          {offering.teacher?.name && <span className="truncate">{offering.teacher.name}</span>}
          <span aria-hidden>·</span>
          <span>{scheduleLabel(offering)}</span>
          <span aria-hidden>·</span>
          <span>{priceLabel(offering)}</span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
    </Link>
  );
}
