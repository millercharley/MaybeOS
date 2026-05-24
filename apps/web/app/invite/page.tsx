'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, InviteInfo } from '@/lib/api';

function InviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const inviteToken = searchParams.get('token');
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);

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
      await loadProfile();
      setTimeout(() => router.push('/admin'), 2000);
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
            You've joined <strong>{invite?.org.name}</strong>. Redirecting to your dashboard...
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
            You're invited to join {invite?.org.name}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            You've been invited as a <strong>{invite?.role}</strong> member.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
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
                href={`/login?redirect=${encodeURIComponent(`/invite?token=${inviteToken}`)}`}
                className="btn-primary block w-full text-center"
              >
                Sign In
              </Link>
              <Link
                href={`/register?redirect=${encodeURIComponent(`/invite?token=${inviteToken}`)}`}
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
