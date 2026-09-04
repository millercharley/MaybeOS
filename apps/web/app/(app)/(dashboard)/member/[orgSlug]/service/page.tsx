'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Repeat, Check, Undo2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, type MyService } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/panel';
import {
  formatMinutes,
  recurrenceLabel,
  shortDate,
  standingSentence,
  timeOf,
} from '@/lib/service-rota';

/** How many turns "Coming up" lists before it summarises the rest. */
const UPCOMING_SHOWN = 8;

/**
 * My Service — what I have taken on, and what it adds up to (SRV-01).
 *
 * Three sections in the order a member cares about them: what I owe the co-op
 * next, what I have on standing, and what I have banked. The total is at the
 * top because it is the one number a member wants when a tier asks something
 * of them.
 */
export default function MyServicePage() {
  const params = useParams();
  const orgSlug = params?.orgSlug as string;
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const orgId = user?.orgs?.find((o) => o.org?.slug === orgSlug)?.orgId;

  const [data, setData] = useState<MyService | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    if (!orgId || !token) {
      setLoading(false);
      return;
    }
    api.service
      .mine(orgId, token)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load your service'),
      )
      .finally(() => setLoading(false));
  }, [orgId, token]);

  useEffect(load, [load]);

  async function act(key: string, run: () => Promise<unknown>) {
    setBusyId(key);
    setError(null);
    try {
      await run();
      setEditing(null);
      setMinutes('');
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  }

  const done = (data?.past ?? []).filter((c) => c.status === 'DONE');

  // Adopting a weekly duty materialises four months of turns, so an
  // un-capped list showed the same duty seventeen times and buried the one
  // fact a member wants: what is next. The rest are not hidden — they are
  // the standing arrangement below, which is where they belong.
  const upcoming = data?.upcoming ?? [];
  const shown = upcoming.slice(0, UPCOMING_SHOWN);
  const hidden = upcoming.length - shown.length;

  return (
    <div>
      <header>
        <PageHeader
          title="My service"
        />
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* The tier's expectation, when there is one. Omitted entirely rather
          than shown as "no requirement": a member whose tier asks nothing does
          not need telling that every time they open the page. */}
      {data?.standing && (
        <Panel className="mt-4">
          <p className="text-sm">{standingSentence(data.standing)}</p>
        </Panel>
      )}

      <Panel className="mt-8" title="Coming up" bodyClassName="">
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Nothing booked in.{' '}
            <Link href={`/portal/${orgSlug}/serve`} className="underline">
              See what needs doing
            </Link>
            .
          </p>
        ) : (
          <ul className="-mx-5 -mb-5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {shown.map((claim) => (
              <li key={claim.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{claim.duty?.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {shortDate(claim.occursAt.slice(0, 10))} ·{' '}
                      {timeOf(claim.occursAt, data!.timezone)}
                      {claim.status === 'CLAIMED' && ' · waiting on an organizer'}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {claim.status === 'CONFIRMED' && (
                      <button
                        onClick={() => setEditing(editing === claim.id ? null : claim.id)}
                        className="btn-secondary inline-flex items-center gap-1 text-sm"
                      >
                        <Check size={14} aria-hidden="true" />
                        Mark done
                      </button>
                    )}
                    <button
                      onClick={() =>
                        act(claim.id, () => api.service.releaseClaim(orgId!, claim.id, token!))
                      }
                      disabled={busyId === claim.id}
                      className="btn-secondary inline-flex items-center gap-1 text-sm"
                    >
                      <Undo2 size={14} aria-hidden="true" />
                      Hand back
                    </button>
                  </div>
                </div>

                {editing === claim.id && (
                  <DoneForm
                    estimate={claim.duty?.estimatedMinutes ?? 30}
                    minutes={minutes}
                    note={note}
                    busy={busyId === claim.id}
                    onMinutes={setMinutes}
                    onNote={setNote}
                    onSubmit={() =>
                      act(claim.id, () =>
                        api.service.complete(
                          orgId!,
                          claim.id,
                          {
                            // Sent only when changed, so an untouched form
                            // credits the estimate rather than re-sending it.
                            ...(minutes ? { minutes: parseInt(minutes, 10) } : {}),
                            ...(note.trim() ? { note: note.trim() } : {}),
                          },
                          token!,
                        ),
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            And {hidden} more after that, from the duties you have on standing.
          </p>
        )}
      </Panel>

      {(data?.adoptions ?? []).length > 0 && (
        <Panel
          className="mt-8"
          title="Mine for good"
          description="You have these on standing. Hand one back and it goes to the co-op — the turns you have already done stay yours."
        >
          <ul className="-mx-5 -mb-5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {data!.adoptions.map((adoption) => (
              <li key={adoption.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <Repeat size={14} aria-hidden="true" />
                    {adoption.duty?.title}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {recurrenceLabel(adoption.duty?.recurrence ?? 'WEEKLY')} · since{' '}
                    {shortDate(adoption.startedAt.slice(0, 10))}
                  </p>
                </div>
                <button
                  onClick={() =>
                    act(adoption.id, () =>
                      api.service.releaseAdoption(orgId!, adoption.id, token!),
                    )
                  }
                  disabled={busyId === adoption.id}
                  className="btn-secondary shrink-0 text-sm"
                >
                  Hand it back
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-8" title="Done">
        {done.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Nothing yet.</p>
        ) : (
          <ul className="-mx-5 -mb-5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {done.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{claim.duty?.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {shortDate(claim.occursAt.slice(0, 10))}
                    {claim.minutesNote && ` · ${claim.minutesNote}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {formatMinutes(claim.minutes ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * Marking a turn done.
 *
 * The estimate is pre-filled as a placeholder rather than a value, so leaving
 * it alone sends nothing and the API credits the duty's own number. Typing
 * over it is what records a correction — which is the distinction the model
 * keeps, and it would be lost if the form always sent a figure.
 */
function DoneForm({
  estimate,
  minutes,
  note,
  busy,
  onMinutes,
  onNote,
  onSubmit,
}: {
  estimate: number;
  minutes: string;
  note: string;
  busy: boolean;
  onMinutes: (value: string) => void;
  onNote: (value: string) => void;
  onSubmit: () => void;
}) {
  const corrected = minutes !== '' && parseInt(minutes, 10) !== estimate;

  return (
    <div className="mt-3 rounded-lg bg-[var(--surface-sunken)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">How long did it take?</span>
          <input
            type="number"
            min={1}
            max={1440}
            className="input mt-1 w-28"
            placeholder={String(estimate)}
            value={minutes}
            onChange={(e) => onMinutes(e.target.value)}
          />
          <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
            Minutes. Leave it for {formatMinutes(estimate)}.
          </span>
        </label>

        {corrected && (
          <label className="block min-w-[16rem] flex-1">
            <span className="text-sm font-medium">What happened?</span>
            <input
              type="text"
              className="input mt-1 w-full"
              maxLength={500}
              placeholder="The bin store was locked and I had to find a key."
              value={note}
              onChange={(e) => onNote(e.target.value)}
            />
          </label>
        )}

        <button onClick={onSubmit} disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Bank it'}
        </button>
      </div>
    </div>
  );
}
