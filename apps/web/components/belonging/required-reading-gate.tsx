'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { useShell } from '@/contexts/shell-context';
import { REQUIRED_READING_EVENT } from '@/lib/api';

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
 *
 * It also answers a refusal (BEL-08). The API still refuses a write past the
 * window, as a backstop behind this — and somebody who got past the gate did
 * so because their tab predates it, or because the check below failed open on
 * a network blip. Either way the refusal lands here and goes to the same
 * screen, rather than being a sentence about an article with no way to reach
 * it.
 */
export function RequiredReadingGate({ orgId, orgSlug }: { orgId?: string; orgSlug?: string }) {
  const token = useAuthStore((s) => s.token);
  const { shell, shellOrgId, ready: shellReady } = useShell();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [sent, setSent] = useState(false);

  const onHandbook = pathname.includes('/handbook');

  /*
    From the shell bundle (OPS-47), which asks once for the whole chrome.

    `shellOrgId === orgId` is load-bearing rather than defensive: this effect
    *redirects*, so seeding it with another co-op's answer would not render a
    wrong badge, it would send somebody to a handbook they do not owe.

    Fails open, exactly as the direct fetch did. A co-op with the tool off
    answers with nothing owed; a bundle whose section failed comes back null,
    and a network blip must never strand somebody on a page they asked for.
  */
  useEffect(() => {
    if (!orgId || !orgSlug || !token || onHandbook || sent) return;
    if (!shellReady || shellOrgId !== orgId) return;

    const outstanding = shell?.reading;
    if (!outstanding || outstanding.blocking.length === 0) return;

    setSent(true);
    router.replace(`/portal/${orgSlug}/handbook/start`);
  }, [orgId, orgSlug, token, onHandbook, sent, router, shell, shellOrgId, shellReady]);

  /*
    The same destination, reached the other way. Deliberately not guarded by
    `sent`: a refusal is a fresh fact about right now, where the check above
    is a once-per-arrival question.
  */
  useEffect(() => {
    if (!orgSlug) return;

    const go = () => router.replace(`/portal/${orgSlug}/handbook/start`);
    window.addEventListener(REQUIRED_READING_EVENT, go);
    return () => window.removeEventListener(REQUIRED_READING_EVENT, go);
  }, [orgSlug, router]);

  return null;
}
