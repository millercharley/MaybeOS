'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { parsePlanIntent, savePlanIntent } from '@/lib/plan-intent';
import { Wordmark } from '@/components/brand/wordmark';

/**
 * Where the landing page's Plus and Unlimited buttons go (PAY-09).
 *
 * A plan belongs to a community, and a visitor usually has neither an account
 * nor a community yet (Charley: sign up, then pay). So this remembers the
 * choice and sends them to sign up; creating their community picks it up and
 * opens Stripe Checkout. Somebody already signed in as an organiser goes
 * straight to Checkout for their community.
 */
function StartPlan() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    const intent = parsePlanIntent(params.get('plan'), params.get('interval'));
    if (!intent) {
      router.replace('/register');
      return;
    }
    if (!token) {
      savePlanIntent(intent);
      router.replace('/register');
      return;
    }
    if (!user) return;

    const admin =
      user.orgs.find((o) => o.orgId === currentOrgId && o.role === 'ADMIN') ?? user.orgs.find((o) => o.role === 'ADMIN');
    if (!admin) {
      // Signed in but running no community: create one first, and the plan
      // follows from there.
      savePlanIntent(intent);
      router.replace('/member');
      return;
    }

    api.billing
      .planCheckout(admin.orgId, intent, token)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Checkout could not be opened.'));
  }, [isLoading, token, user, currentOrgId, params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex justify-center">
          <Wordmark height={28} />
        </div>
        {error ? (
          <>
            <p className="mt-6 text-sm text-ink">{error}</p>
            <Link href="/member" className="btn-secondary mt-6 justify-center">
              Go to MaybeOS
            </Link>
          </>
        ) : (
          <p className="mt-6 text-sm text-ink-soft" role="status">
            Getting your plan ready…
          </p>
        )}
      </div>
    </div>
  );
}

export default function StartPlanPage() {
  return (
    <Suspense>
      <StartPlan />
    </Suspense>
  );
}
