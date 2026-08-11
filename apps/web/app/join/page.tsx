'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, ApiError } from '@/lib/api';

/**
 * The bridge between "Join as Sustainer" on a co-op's public page and Stripe.
 *
 * Before this existed, that button was a bare link to /register: the org and
 * tier were discarded, no membership was ever created, and the dashboard —
 * seeing a user with no organizations — offered to create a *new* one. Someone
 * trying to join MaybeItsFate in production ended up being invited to found
 * their own co-op instead.
 *
 * Deliberately outside the (dashboard) route group. That layout renders
 * <OrgSetup /> for any user without an organization, which is exactly the
 * screen that hijacked the flow.
 *
 * Login and register already honour `?redirect=`, so an anonymous visitor is
 * sent to sign up and comes straight back here with their choice intact.
 */
function JoinFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  const orgSlug = params.get('org');
  const tierId = params.get('tier') ?? undefined;

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Setting up your membership…');
  // Strict mode runs effects twice in development; joining is idempotent
  // server-side, but starting two checkout sessions is still wasteful.
  const started = useRef(false);

  useEffect(() => {
    if (isLoading || started.current) return;

    if (!orgSlug) {
      setError('That link is missing which co-op to join.');
      return;
    }

    const here = `/join?org=${encodeURIComponent(orgSlug)}${tierId ? `&tier=${encodeURIComponent(tierId)}` : ''}`;

    if (!token) {
      router.replace(`/register?redirect=${encodeURIComponent(here)}`);
      return;
    }

    started.current = true;

    (async () => {
      try {
        setStatus('Finding the co-op…');
        const org = await api.orgs.getBySlug(orgSlug);

        setStatus('Adding you as a member…');
        await api.members.joinOrg(org.id, tierId, token);

        // The profile in memory predates this membership, so refresh it before
        // any redirect lands on a page that reads orgs from the store.
        await loadProfile();

        if (!tierId) {
          router.replace('/member');
          return;
        }

        setStatus('Taking you to payment…');
        const origin = window.location.origin;
        const { url } = await api.stripe.createCheckout(
          org.id,
          {
            tierId,
            successUrl: `${origin}/member/billing?checkout=success`,
            cancelUrl: `${origin}/member/billing?checkout=canceled`,
          },
          token,
        );
        window.location.href = url;
      } catch (err) {
        // A member who already has dues gets 409 from checkout — not a failure,
        // just someone who is already set up.
        if (err instanceof ApiError && err.status === 409) {
          router.replace('/member/billing');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : "Something went wrong joining. Please try again.",
        );
      }
    })();
  }, [isLoading, token, orgSlug, tierId, router, loadProfile]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-lg">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger)]" />
            <div>
              <h1 className="font-display text-xl">Couldn&apos;t join</h1>
              <p className="mt-2 text-[var(--text-secondary)]">{error}</p>
              <div className="mt-4 flex gap-3">
                {orgSlug && (
                  <Link href={`/orgs/${orgSlug}`} className="btn-secondary">
                    Back to the co-op
                  </Link>
                )}
                <Link href="/" className="btn-ghost">
                  Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" aria-hidden="true" />
      <p className="text-[var(--text-secondary)]">{status}</p>
    </div>
  );
}

/**
 * useSearchParams() forces a client bailout, which Next requires a Suspense
 * boundary for when the route is prerendered. Without this the build fails
 * outright rather than degrading.
 */
export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" aria-hidden="true" />
        </div>
      }
    >
      <JoinFlow />
    </Suspense>
  );
}
