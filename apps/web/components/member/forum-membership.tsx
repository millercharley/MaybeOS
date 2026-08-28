'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe2, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';
import type { ForumStatus } from '@/lib/api';

/**
 * A member's own relationship with the MaybeOS community (FRM-01).
 *
 * Two separate things, kept separate because people feel differently about
 * them: **being in the forum**, and **being listed in its directory**. Being
 * enrolled by MaybeOS is one thing; appearing on a roster of every customer
 * is another, and somebody should be able to take part without the second.
 *
 * Renders nothing on a deployment with no forum, so a self-hosted MaybeOS is
 * not advertising a community it has no connection to.
 */
export function ForumMembership() {
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<ForumStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!token) return;
    api.forum
      .status(token)
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(load, [token]);

  if (!status || !status.available) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
        <Globe2 className="h-4 w-4" />
        {status.forum.name}
      </h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Where the people running co-ops on MaybeOS compare notes with each other. Organisers are
        added when they start a co-op.
      </p>

      {status.member ? (
        <>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            <Link href={`/portal/${status.forum.slug}/commons`} className="text-brand-700 underline">
              Open the community
            </Link>
          </p>

          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            {/* Said plainly, because the surprising thing about this feature
                is being in a room with every other customer. */}
            {status.listedInDirectory
              ? 'Other members can find you in its directory.'
              : 'You are not listed in its directory — you can take part without being findable. Change this on your profile in that community.'}
          </p>

          <button
            disabled={busy}
            onClick={() => act(() => api.forum.leave(token!))}
            className="mt-4 text-sm text-[var(--text-tertiary)] underline hover:text-red-600"
          >
            {busy && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />}
            Leave the community
          </button>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {/* The reassurance that makes leaving safe to do. */}
            You won&rsquo;t be added back when you start another co-op.
          </p>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => act(() => api.forum.join(token!))}
          className="btn-secondary mt-4 text-sm"
        >
          {busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
          {status.optedOut ? 'Join after all' : 'Join'}
        </button>
      )}
    </section>
  );
}
