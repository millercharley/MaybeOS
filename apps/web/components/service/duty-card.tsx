'use client';

import { Clock, Users, Repeat, ShieldCheck } from 'lucide-react';
import type { DutyOccurrence } from '@/lib/api';
import { coverage, formatMinutes, recurrenceLabel, timeOf } from '@/lib/service-rota';

/**
 * One turn, as a member sees it on the open list (SRV-01).
 *
 * The card answers three questions in the order somebody asks them: what is
 * it, is anybody on it, and can I take it. The estimate is on the face of it
 * rather than behind a tooltip, because the reason a member hesitates over a
 * rota is not knowing what they are agreeing to.
 */
export function DutyCard({
  occurrence,
  timezone,
  myUserId,
  busy,
  onClaim,
  onAdopt,
}: {
  occurrence: DutyOccurrence;
  timezone: string;
  myUserId?: string | null;
  busy: boolean;
  onClaim: () => void;
  onAdopt: () => void;
}) {
  const state = coverage(occurrence, myUserId);
  const recurring = occurrence.recurrence !== 'NONE';

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold">{occurrence.title}</h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <Clock size={13} aria-hidden="true" />
              {timeOf(occurrence.occursAt, timezone)} ·{' '}
              {formatMinutes(occurrence.estimatedMinutes)}
            </span>
            {recurring && (
              <span className="inline-flex items-center gap-1">
                <Repeat size={13} aria-hidden="true" />
                {recurrenceLabel(occurrence.recurrence, occurrence.date)}
              </span>
            )}
            {occurrence.capacity > 1 && (
              <span className="inline-flex items-center gap-1">
                <Users size={13} aria-hidden="true" />
                Needs {occurrence.capacity}
              </span>
            )}
            {occurrence.requiresApproval && (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={13} aria-hidden="true" />
                An organiser confirms this one
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={[
              'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium',
              state.tone === 'mine'
                ? 'border border-[var(--success)] text-[var(--success)]'
                : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {state.label}
          </span>

          {state.tone === 'open' && (
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={onClaim} disabled={busy} className="btn-secondary text-sm">
                {busy ? 'Saving…' : "I'll do it"}
              </button>
              {/* Only on a recurring duty: "all of these" is meaningless for a
                  one-off, and the API refuses it. */}
              {recurring && (
                <button onClick={onAdopt} disabled={busy} className="btn-secondary text-sm">
                  I&apos;ll take all of these
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {occurrence.description && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">{occurrence.description}</p>
      )}
    </li>
  );
}
