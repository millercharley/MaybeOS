'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

/**
 * Where Stripe sends an organiser after they subscribe to MaybeOS.
 *
 * Without this, Stripe's own confirmation page is the end of the road: the
 * co-op has paid and has no way back into the product except the browser's
 * back button, which lands on a checkout that is no longer valid.
 *
 * **It waits for the plan rather than announcing it.** The plan is applied by
 * `checkout.session.completed`, and a webhook can land *after* the redirect —
 * which is the same trap PAY-07 hit, where a ticket confirmation claimed a row
 * the webhook had not written yet. So this polls until the plan actually
 * changes and says "confirming" until then. Claiming a plan that is not there
 * would send an organiser to a settings page still reading FREE.
 */
export default function BillingThanksPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const membership =
    user?.orgs?.find((o) => o.orgId === currentOrgId) ?? user?.orgs?.[0];
  const slug = membership?.org?.slug;
  const orgId = membership?.orgId;

  const [plan, setPlan] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const settingsHref = slug ? `/admin/${slug}/settings` : '/';

  const check = useCallback(async () => {
    if (!token || !orgId) return null;
    try {
      const org = await api.orgs.get(orgId, token);
      return org.plan ?? null;
    } catch {
      return null;
    }
  }, [token, orgId]);

  useEffect(() => {
    if (!token || !orgId) return;
    let live = true;
    let tries = 0;

    const poll = async () => {
      const found = await check();
      if (!live) return;

      // Anything other than FREE means the webhook has landed.
      if (found && found !== 'FREE') {
        setPlan(found);
        // Straight on to the page that shows what they now have.
        setTimeout(() => {
          if (live) window.location.assign(`${settingsHref}?subscribed=1`);
        }, 1200);
        return;
      }

      // Twenty tries at 1.5s — thirty seconds. A webhook that has not landed
      // by then is not going to be waited out on a confirmation screen, and
      // saying so is better than spinning forever.
      if (++tries >= 20) {
        setGaveUp(true);
        return;
      }
      setTimeout(poll, 1500);
    };

    poll();
    return () => {
      live = false;
    };
  }, [token, orgId, check, settingsHref]);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      {plan ? (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Check className="h-6 w-6 text-green-700" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            You&apos;re on MaybeOS {plan === 'PLUS' ? 'Plus' : 'Unlimited'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">Taking you back to your settings…</p>
        </>
      ) : gaveUp ? (
        <>
          <h1 className="text-2xl font-bold text-gray-900">Payment received</h1>
          <p className="mt-2 text-sm text-gray-500">
            {/* Honest rather than reassuring: the money moved, and the plan
                has not appeared yet. Telling them it is done when it is not
                is how somebody stops looking at a real problem. */}
            Your payment went through, but your plan hasn&apos;t updated yet. It usually takes a
            few seconds. If it still looks wrong in a minute, tell us and we&apos;ll sort it —
            you have definitely paid.
          </p>
          <Link href={settingsHref} className="btn-primary mt-6">
            Back to settings
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          <h1 className="mt-4 text-xl font-semibold text-gray-900">Confirming your plan…</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your payment went through. We&apos;re just waiting for Stripe to tell us.
          </p>
        </>
      )}
    </div>
  );
}
