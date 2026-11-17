'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, GraduationCap, Users } from 'lucide-react';
import { usePublicApi } from '@/hooks/use-api';
import { api, type Offering } from '@/lib/api';

/**
 * What a community teaches, for somebody with no account (TCH-01, PUB-05).
 *
 * The public half of the standalone page. It sits in `(public)` beside the
 * join page and the public events list, and borrows their look rather than
 * the app's — a visitor has no sidebar to be offered, and wrapping this in
 * the signed-in shell would invite them to things they cannot reach.
 *
 * **Only what a member chose to make public is here.** The API answers a
 * narrow select — the teacher's name and picture, never an address, never who
 * has asked — and offerings kept to the co-op are absent rather than
 * redacted. That is the whole difference between this page and the portal
 * one, and it is enforced server-side, not by what this file draws.
 *
 * No contact details anywhere. A visitor who wants a lesson follows the link
 * into MaybeOS and asks there, which is how the teacher's address stays the
 * teacher's.
 */
export default function PublicTeachingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, loading, error } = usePublicApi(() => api.teaching.publicList(slug), [slug]);

  const [tab, setTab] = useState<'WORKSHOP' | 'PRIVATE_LESSON'>('WORKSHOP');

  const { workshops, lessons } = useMemo(() => {
    const all = data?.offerings ?? [];
    return {
      workshops: all.filter((o) => o.kind === 'WORKSHOP'),
      lessons: all.filter((o) => o.kind === 'PRIVATE_LESSON'),
    };
  }, [data]);

  const shown = tab === 'WORKSHOP' ? workshops : lessons;
  const orgName = data?.org?.name ?? 'This community';

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link
          href={`/orgs/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {orgName}
        </Link>

        <h1 className="mt-4 font-display text-3xl leading-tight text-ink">
          Workshops and lessons
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Taught by people at {orgName}.
        </p>

        {/* Loading, empty and error all say something specific (DESIGN §7). */}
        {loading && (
          <p className="mt-10 text-sm text-[var(--text-secondary)]">Loading…</p>
        )}

        {error && (
          <p className="mt-10 text-sm text-red-700" role="alert">
            We could not load this just now. Try again in a moment.
          </p>
        )}

        {data && (
          <>
            <div className="mt-8 flex gap-1" role="tablist" aria-label="What kind">
              <Tab
                chosen={tab === 'WORKSHOP'}
                onChoose={() => setTab('WORKSHOP')}
                label="Workshops"
                count={workshops.length}
              />
              <Tab
                chosen={tab === 'PRIVATE_LESSON'}
                onChoose={() => setTab('PRIVATE_LESSON')}
                label="Private lessons"
                count={lessons.length}
              />
            </div>

            {shown.length === 0 ? (
              <div className="mt-8 rounded-xl border border-gray-200 bg-white p-10 text-center">
                <GraduationCap className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
                <p className="mt-3 text-sm font-semibold text-ink">
                  {tab === 'WORKSHOP'
                    ? 'No public workshops just now.'
                    : 'Nobody is publicly offering lessons just now.'}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Members post these themselves, so it changes often. Worth looking again.
                </p>
              </div>
            ) : (
              <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((offering) => (
                  <li key={offering.slug} className="min-w-0">
                    <PublicCard offering={offering} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One offering, for a stranger.
 *
 * Its own card rather than the app's `OfferingCard`, because the two answer
 * different questions: that one links inside the app and shows a member what
 * to press, and this one is a poster. A visitor cannot register interest
 * without an account, so the link goes to the offering's page and lets
 * MaybeOS ask them to sign in — rather than a button here that fails.
 */
function PublicCard({ offering }: { offering: Offering & { url?: string } }) {
  const next = offering.sessions?.[0];

  return (
    <a
      href={offering.url ?? '#'}
      className="block h-full rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      {offering.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={offering.imageUrl}
          alt=""
          className="mb-3 h-28 w-full rounded-lg object-cover"
          style={{ objectPosition: `50% ${offering.imageFocusY ?? 50}%` }}
        />
      )}

      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
        {offering.kind === 'WORKSHOP' ? (
          <Users className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <GraduationCap className="h-3.5 w-3.5" aria-hidden />
        )}
        {offering.kind === 'WORKSHOP' ? 'Workshop' : 'Private lessons'}
      </p>

      <h2 className="mt-1.5 text-base font-semibold leading-snug text-ink">
        {offering.title}
      </h2>

      {offering.teacher?.name && (
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
          with {offering.teacher.name}
        </p>
      )}

      {offering.summary && (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{offering.summary}</p>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--text-tertiary)]">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        <span>
          {offering.kind === 'PRIVATE_LESSON'
            ? 'Arranged with you'
            : next
              ? new Date(next.startTime).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
              : 'No dates yet'}
        </span>
        <span aria-hidden>·</span>
        <span>
          {offering.priceNote ??
            (offering.priceCents
              ? `$${(offering.priceCents / 100).toFixed(2)}`
              : offering.kind === 'PRIVATE_LESSON'
                ? 'Ask about rates'
                : 'Free')}
        </span>
      </p>
    </a>
  );
}

function Tab({
  chosen,
  onChoose,
  label,
  count,
}: {
  chosen: boolean;
  onChoose: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={chosen}
      onClick={onChoose}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        chosen ? 'bg-ink text-paper' : 'text-[var(--text-secondary)] hover:bg-white'
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
    </button>
  );
}
