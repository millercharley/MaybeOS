'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Repeat, Trash2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import {
  api,
  type CoopStanding,
  type DutyOpenings,
  type PendingClaim,
  type StandingDuty,
} from '@/lib/api';
import {
  byDate,
  coverage,
  formatMinutes,
  recurrenceLabel,
  shortDate,
  timeOf,
} from '@/lib/service-rota';
import { DutyForm } from '@/components/service/duty-form';

/**
 * Serving — naming the work, and seeing whether it is covered (SRV-01).
 *
 * The order is deliberate: what needs somebody comes first, because a rota's
 * whole job is surfacing the gap. Who is short of their tier is last — it is
 * the least urgent thing on the page and the most tempting to lead with.
 */
export default function ServingPage() {
  const params = useParams();
  const orgSlug = params?.orgSlug as string;
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const orgId = user?.orgs?.find((o) => o.org?.slug === orgSlug)?.orgId;

  const [openings, setOpenings] = useState<DutyOpenings | null>(null);
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [adoptions, setAdoptions] = useState<StandingDuty[]>([]);
  const [standing, setStanding] = useState<CoopStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!orgId || !token) {
      setLoading(false);
      return;
    }
    Promise.all([
      api.service.openings(orgId, {}, token),
      api.service.pending(orgId, token),
      api.service.adoptions(orgId, token),
      api.service.standing(orgId, token),
    ])
      .then(([o, p, a, s]) => {
        setOpenings(o);
        setPending(p);
        setAdoptions(a);
        setStanding(s);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load the rota'),
      )
      .finally(() => setLoading(false));
  }, [orgId, token]);

  useEffect(load, [load]);

  async function act(key: string, run: () => Promise<unknown>) {
    setBusyId(key);
    setError(null);
    try {
      await run();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  // One row per duty, from the computed occurrences — the duties themselves
  // are not fetched separately, since every one that is running appears here.
  const duties = new Map<
    string,
    { title: string; recurrence: string; estimate: number; firstDate: string }
  >();
  for (const occurrence of openings?.occurrences ?? []) {
    if (!duties.has(occurrence.dutyId)) {
      duties.set(occurrence.dutyId, {
        title: occurrence.title,
        recurrence: occurrence.recurrence,
        estimate: occurrence.estimatedMinutes,
        // Occurrences arrive in date order, so the first one seen is the
        // earliest — which is what names the weekday: "Every Tuesday" rather
        // than a bare "Weekly", which tells an organiser nothing they did not
        // already know from having created it.
        firstDate: occurrence.date,
      });
    }
  }

  const gaps = (openings?.occurrences ?? []).filter((o) => o.remaining > 0);
  const shortMembers = (standing?.members ?? []).filter(
    (m) => m.standing && (m.standing.shortfallMinutes ?? 0) > 0,
  );

  if (loading) {
    return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Serving</h1>
          <p className="mt-1 text-[var(--text-secondary)]">
            Name what the co-op needs doing. Members take turns from Serve.
          </p>
        </div>
        <button
          onClick={() => setCreating((open) => !open)}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus size={16} aria-hidden="true" />
          Add a duty
        </button>
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {creating && (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <DutyForm
            busy={busyId === 'new'}
            onCancel={() => setCreating(false)}
            onSubmit={(input) =>
              act('new', async () => {
                await api.service.createDuty(orgId!, input, token!);
                setCreating(false);
              })
            }
          />
        </div>
      )}

      {/* Claims waiting on somebody. First, because a member who volunteered
          for a gated duty is being kept waiting by this page existing. */}
      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">Waiting on you</h2>
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {pending.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {claim.user.name ?? 'A member'} · {claim.duty.title}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {shortDate(claim.occursAt.slice(0, 10))} ·{' '}
                    {formatMinutes(claim.duty.estimatedMinutes)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() =>
                      act(claim.id, () => api.service.confirmClaim(orgId!, claim.id, token!))
                    }
                    disabled={busyId === claim.id}
                    className="btn-primary text-sm"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() =>
                      act(claim.id, () => api.service.rejectClaim(orgId!, claim.id, token!))
                    }
                    disabled={busyId === claim.id}
                    className="btn-secondary text-sm"
                  >
                    Not this one
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">Needs somebody</h2>
        {gaps.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {duties.size === 0
              ? 'No duties yet. Add one and it appears on Serve for members to take.'
              : 'Everything in the next two months is covered.'}
          </p>
        ) : (
          <div className="mt-2 space-y-4">
            {byDate(gaps).map((group) => (
              <div key={group.date}>
                <h3 className="text-sm font-semibold text-[var(--text-secondary)]">
                  {shortDate(group.date)}
                </h3>
                <ul className="mt-1 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                  {group.occurrences.map((occurrence) => (
                    <li
                      key={`${occurrence.dutyId}:${occurrence.date}`}
                      className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{occurrence.title}</span>
                        <span className="ml-2 text-xs text-[var(--text-secondary)]">
                          {timeOf(occurrence.occursAt, openings!.timezone)} ·{' '}
                          {formatMinutes(occurrence.estimatedMinutes)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                        {coverage(occurrence).label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {duties.size > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">The rota</h2>
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {[...duties.entries()].map(([id, duty]) => {
              const held = adoptions.find((a) => a.dutyId === id);

              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{duty.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[var(--text-secondary)]">
                      <span>
                        {recurrenceLabel(duty.recurrence as never, duty.firstDate)} ·{' '}
                        {formatMinutes(duty.estimate)}
                      </span>
                      {held && (
                        <span className="inline-flex items-center gap-1">
                          <Repeat size={12} aria-hidden="true" />
                          {held.user.name ?? 'A member'} has it on standing since{' '}
                          {shortDate(held.startedAt.slice(0, 10))}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      act(id, () => api.service.removeDuty(orgId!, id, token!))
                    }
                    disabled={busyId === id}
                    className="btn-secondary inline-flex shrink-0 items-center gap-1 text-sm"
                    title="Retired, not deleted, once anybody has served it"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Retire
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">Hours by member</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {shortMembers.length === 0
            ? 'Nobody is short of what their tier asks.'
            : `${shortMembers.length} ${shortMembers.length === 1 ? 'member has' : 'members have'} time still to give this period.`}
        </p>

        <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {(standing?.members ?? []).map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{member.name ?? 'A member'}</span>
                {member.tier && (
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">{member.tier}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {member.standing?.shortfallMinutes ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {formatMinutes(member.standing.shortfallMinutes)} to go
                  </span>
                ) : null}
                <span className="font-medium">{formatMinutes(member.totalMinutes)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Expectations are set per tier, under Tiers &amp; Dues.
        </p>
      </section>
    </div>
  );
}
