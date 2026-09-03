'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HandHelping, CalendarDays } from 'lucide-react';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import { api, type DutyOpenings } from '@/lib/api';
import { byDate, shortDate, formatMinutes } from '@/lib/service-rota';
import { DutyCard } from '@/components/service/duty-card';
import { PageHeader } from '@/components/layout/page-header';

/**
 * Serve — what the co-op needs doing (SRV-01).
 *
 * Grouped by day rather than by duty. A member opening this is answering "can
 * I help this week", not "what are all the standing arrangements" — and a list
 * by duty buries next Tuesday under a heading about bins.
 */
export default function ServePage() {
  const { org, orgSlug } = usePortal();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<DutyOpenings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const orgId = org?.id;

  const load = useCallback(() => {
    if (!orgId || !token) {
      setLoading(false);
      return;
    }
    api.service
      .openings(orgId, {}, token)
      .then(setData)
      // Not a silent catch: "nothing needs doing" and "we could not ask" look
      // identical on an empty page and are entirely different problems.
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load the rota'),
      )
      .finally(() => setLoading(false));
  }, [orgId, token]);

  useEffect(load, [load]);

  async function act(key: string, run: () => Promise<unknown>, said: string) {
    setBusyId(key);
    setError(null);
    setNotice(null);
    try {
      await run();
      setNotice(said);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  if (!token) {
    return (
      <div className="py-12 text-center">
        <HandHelping className="mx-auto h-10 w-10 text-[var(--text-tertiary)]" />
        <PageHeader
          title="Serve"
          description="Sign in to see what needs doing and take a turn."
        />
        <Link href="/login" className="btn-primary mt-4 inline-block">
          Sign in
        </Link>
      </div>
    );
  }

  const groups = byDate(data?.occurrences ?? []);
  const openCount = (data?.occurrences ?? []).filter((o) => o.remaining > 0).length;

  return (
    <div>
      <header>
        <PageHeader
          title="Serve"
          description="What the co-op needs doing. Take a single turn, or take one on for good."
        />
      </header>

      {notice && (
        <p className="mt-4 rounded-lg border border-[var(--success)] px-4 py-3 text-sm">
          {notice}{' '}
          <Link href={`/member/${orgSlug}/service`} className="underline">
            See My Service
          </Link>
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-[var(--text-secondary)]">Loading the rota…</p>
      ) : groups.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
          <HandHelping className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
          <p className="mt-3 font-medium">Nothing on the rota yet.</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            An organiser has not named anything that needs doing. When they do, it turns
            up here.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-[var(--text-secondary)]">
            {openCount === 0
              ? 'Everything in the next two months is covered.'
              : `${openCount} ${openCount === 1 ? 'turn needs' : 'turns need'} somebody in the next two months.`}
          </p>

          <div className="mt-4 space-y-6">
            {groups.map((group) => (
              <section key={group.date}>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
                  <CalendarDays size={14} aria-hidden="true" />
                  {shortDate(group.date)}
                </h3>
                <ul className="mt-2 space-y-2">
                  {group.occurrences.map((occurrence) => (
                    <DutyCard
                      key={`${occurrence.dutyId}:${occurrence.date}`}
                      occurrence={occurrence}
                      timezone={data?.timezone ?? 'UTC'}
                      myUserId={user?.id}
                      busy={busyId === `${occurrence.dutyId}:${occurrence.date}`}
                      onClaim={() =>
                        act(
                          `${occurrence.dutyId}:${occurrence.date}`,
                          () =>
                            api.service.claim(
                              orgId!,
                              occurrence.dutyId,
                              [occurrence.date],
                              token,
                            ),
                          `You're down for ${occurrence.title} on ${shortDate(occurrence.date)} — ${formatMinutes(occurrence.estimatedMinutes)}.`,
                        )
                      }
                      onAdopt={() =>
                        act(
                          `${occurrence.dutyId}:${occurrence.date}`,
                          () => api.service.adopt(orgId!, occurrence.dutyId, token),
                          `${occurrence.title} is yours from now on. You can hand it back any time from My Service.`,
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
