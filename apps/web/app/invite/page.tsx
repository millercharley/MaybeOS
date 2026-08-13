'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, InviteInfo } from '@/lib/api';

function InviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const inviteToken = searchParams.get('token');
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!inviteToken) {
      setError('No invitation token provided');
      setLoading(false);
      return;
    }

    api.invites
      .get(inviteToken)
      .then(setInvite)
      .catch((err) => setError(err instanceof Error ? err.message : 'Invalid or expired invitation'))
      .finally(() => setLoading(false));
  }, [inviteToken]);

  async function handleAccept() {
    if (!inviteToken || !token) return;
    setAccepting(true);
    try {
      const result = await api.invites.accept(inviteToken, token);
      setAccepted(true);
      // The org the invitation was for, not whichever one happened to be
      // selected. The result used to be discarded entirely.
      setCurrentOrg(result.orgId);
      await loadProfile();
      // And land them somewhere they can actually use. This always pushed
      // /admin, so a member accepting an invitation arrived at an organiser
      // dashboard — a wall of 403s before IMP-11, and "this page is for
      // organisers" after it. Most invitations are for members.
      // loadProfile resolves void, so the refreshed user comes off the store.
      const role = useAuthStore
        .getState()
        .user?.orgs?.find((o) => o.orgId === result.orgId)?.role;
      // An invitation that named a tier owes dues (MEM-04). Accepting used to
      // stop at the membership, so an invited member joined free while
      // somebody arriving through the public page paid — one co-op, two
      // prices, decided by which door you came through. /join already knows
      // how to create the membership and hand off to Stripe, and is safe to
      // re-enter: it treats an existing membership as done rather than an
      // error.
      if (result.tierId && invite?.org?.slug) {
        const next = `/join?org=${encodeURIComponent(invite.org.slug)}&tier=${encodeURIComponent(result.tierId)}`;
        setTimeout(() => router.push(next), 1200);
        return;
      }

      const home = role === 'ADMIN' || role === 'STAFF' ? '/admin' : '/member';
      setTimeout(() => router.push(home), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Invalid Invitation</h1>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
          <Link href="/login" className="btn-primary mt-6 inline-block">
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Welcome!</h1>
          <p className="mt-2 text-sm text-gray-500">
            You&apos;ve joined <strong>{invite?.org.name}</strong>. Redirecting to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8">
        <div className="text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl"
            style={{ backgroundColor: invite?.org.brandColor || '#6366f1' }}
          >
            <span className="text-2xl font-bold text-white">
              {invite?.org.name?.charAt(0) || 'O'}
            </span>
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">
            You&apos;re invited to join {invite?.org.name}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            You&apos;ve been invited as a <strong>{invite?.role}</strong> member.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {invite?.tier && (
          <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Membership: <strong>{invite.tier.name}</strong>
            {invite.tier.priceMonthly > 0 && (
              <> — ${(invite.tier.priceMonthly / 100).toFixed(2)}/month</>
            )}
            <span className="mt-0.5 block text-xs text-gray-500">
              You&apos;ll be asked to set this up after joining.
            </span>
          </div>
        )}

        <div className="mt-6">
          {token ? (
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="btn-primary w-full"
            >
              {accepting ? 'Joining...' : 'Accept Invitation'}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-gray-600">
                Sign in or create an account to accept this invitation.
              </p>
              <Link
                href={`/login?redirect=${encodeURIComponent(`/invite?token=${inviteToken}`)}${
                  invite?.email ? `&email=${encodeURIComponent(invite.email)}` : ''
                }`}
                className="btn-primary block w-full text-center"
              >
                Sign In
              </Link>
              <Link
                href={`/register?redirect=${encodeURIComponent(`/invite?token=${inviteToken}`)}${
                  invite?.email ? `&email=${encodeURIComponent(invite.email)}` : ''
                }`}
                className="btn-secondary block w-full text-center"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
