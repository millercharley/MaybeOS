'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { landingPathFor } from '@/lib/landing';

function MagicLinkVerifier() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setError('No verification token found. Please request a new magic link.');
      return;
    }

    api.auth
      .verifyMagicLink(token)
      .then(async (result) => {
        setToken(result.accessToken);
        setStatus('success');

        // Signing in is not the same as being an organiser. This used to push
        // everyone at /admin, so a member following a link from their inbox
        // arrived at "This page is for organisers".
        let destination = '/member';
        try {
          const user = await api.auth.profile(result.accessToken);
          destination = landingPathFor(
            user,
            typeof window !== 'undefined' ? localStorage.getItem('maybeos_org') : null,
          );
        } catch {
          // Signed in, but we could not read the profile. /member renders for
          // everyone, so it is the safe place to land — never a locked page.
        }
        router.push(destination);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'Verification failed. The link may have expired.';
        setError(message);
        setStatus('error');
      });
  }, [searchParams, router, setToken]);

  if (status === 'loading') {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Verifying...</h2>
        <p className="text-gray-600">
          Please wait while we verify your magic link.
        </p>
        <div className="mt-6 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Verification Failed</h2>
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        <a href="/login" className="btn-primary inline-block">
          Back to Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h2 className="mb-4 text-2xl font-bold text-gray-900">Success!</h2>
      <p className="text-gray-600">You have been signed in. Redirecting...</p>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center">
          <h2 className="mb-4 text-2xl font-bold text-gray-900">Loading...</h2>
          <div className="mt-6 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
          </div>
        </div>
      }
    >
      <MagicLinkVerifier />
    </Suspense>
  );
}
