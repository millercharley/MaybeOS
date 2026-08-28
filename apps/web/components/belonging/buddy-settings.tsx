'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HeartHandshake, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, MyBuddyState } from '@/lib/api';

/**
 * A member's own corner of the Buddy System (PRD §5.2, §5.3).
 *
 * Two things belong to the member rather than to the co-op: **who they are
 * paired with**, and **whether they want to be asked at all**. The Off the
 * Hook email links straight here, which is why the opt-out is one toggle
 * rather than a preferences page — somebody who has just decided they would
 * rather not be asked again should not have to hunt.
 *
 * Renders nothing when the tool is off or the member has no history, so a
 * co-op that never turned this on has no orphaned setting sitting in
 * everybody's profile.
 */
export function BuddySettings({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [state, setState] = useState<MyBuddyState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !orgId) return;
    api.belonging.myBuddyState(orgId, token).then(setState).catch(() => setState(null));
  }, [token, orgId]);

  if (!state) return null;
  const hasHistory = state.timesServed > 0 || state.buddyingFor || state.myBuddy || state.optedOut;
  if (!hasHistory) return null;

  return (
    <section className="card" id="buddy">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
        <HeartHandshake className="h-4 w-4" />
        Welcoming
      </h2>

      {state.myBuddy && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          <b>{state.myBuddy.name ?? 'Someone'}</b> offered to be your first point of contact here.{' '}
          <Link
            href={`/portal/${orgSlug}/messages/${state.myBuddy.userId}`}
            className="text-brand-700 underline"
          >
            Say hello
          </Link>
          .
        </p>
      )}

      {state.buddyingFor && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          You are welcoming <b>{state.buddyingFor.name ?? 'a new member'}</b>.{' '}
          <Link
            href={`/portal/${orgSlug}/messages/${state.buddyingFor.userId}`}
            className="text-brand-700 underline"
          >
            Open the conversation
          </Link>
          .
        </p>
      )}

      {state.timesServed > 0 && (
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">
          You have welcomed {state.timesServed}{' '}
          {state.timesServed === 1 ? 'person' : 'people'} here. Thank you.
        </p>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={state.optedOut}
          disabled={busy}
          onChange={async (e) => {
            if (!token) return;
            const optedOut = e.target.checked;
            setState({ ...state, optedOut });
            setBusy(true);
            try {
              await api.belonging.setBuddyOptOut(orgId, optedOut, token);
            } catch {
              setState({ ...state, optedOut: !optedOut });
            } finally {
              setBusy(false);
            }
          }}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
        />
        <span>
          Don&rsquo;t ask me to welcome new members
          <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
            {/* Said plainly, because the fear that stops people opting out is
                that it will be held against them. */}
            Nobody is told, and it changes nothing else about your membership. You can turn it back
            on whenever you like.
          </span>
        </span>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </label>
    </section>
  );
}
