'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

/**
 * The handbook, once somebody's thirty days have run out (BEL-07).
 *
 * Charley: "After 30 days, force them to the Handbook after login and remind
 * them they must review the required documents."
 *
 * This is what replaced refusing their writes. The API used to answer 403 to
 * every POST while anything was outstanding, so the rule landed on whatever
 * the member happened to be doing — and what they were doing was the thing
 * they had come to do. Four hundred and two of MaybeItsFate's 439 members
 * were in that state and nobody had reported it as an outage, because each
 * person met it alone, once, as a sentence about the handbook.
 *
 * Meeting it at the door is the same rule at a better moment: nothing is
 * half-finished, and the next screen is the one that resolves it.
 *
 * **Only when the window has actually closed.** A member still inside their
 * thirty days gets the banner, which says what is owed and by when, and is
 * otherwise left alone.
 *
 * **Reading is still never gated**, so the handbook itself is reachable —
 * which it has to be, or this would be a loop.
 */
export function RequiredReadingGate({ orgId, orgSlug }: { orgId?: string; orgSlug?: string }) {
  const token = useAuthStore((s) => s.token);
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [sent, setSent] = useState(false);

  const onHandbook = pathname.includes('/handbook');

  useEffect(() => {
    if (!orgId || !orgSlug || !token || onHandbook || sent) return;

    let live = true;
    api.belonging
      .outstandingReading(orgId, token)
      .then((outstanding) => {
        if (!live || outstanding.blocking.length === 0) return;
        setSent(true);
        router.replace(`/portal/${orgSlug}/handbook/start`);
      })
      // A co-op with the tool off answers with nothing owed, and a network
      // blip should never strand somebody on a page they asked for.
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [orgId, orgSlug, token, onHandbook, sent, router]);

  return null;
}
