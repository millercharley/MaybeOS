'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { landingPathFor } from '@/lib/landing';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only an explicit ?redirect is honoured here; where a bare sign-in lands
  // depends on who signed in, which is not known until the profile loads.
  const redirectTo = searchParams.get('redirect');
  const setToken = useAuthStore((s) => s.setToken);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkMode, setMagicLinkMode] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (magicLinkMode) {
        await api.auth.magicLink(email);
        setMagicLinkSent(true);
      } else {
        const result = await api.auth.login({ email, password });
        setToken(result.accessToken);

        // Defaulted to /admin for everyone, so members signed in and were told
        // the page was for organisers.
        let destination = redirectTo ?? '/member';
        if (!redirectTo) {
          try {
            const user = await api.auth.profile(result.accessToken);
            destination = landingPathFor(user, localStorage.getItem('maybeos_org'));
          } catch {
            // Signed in but the profile would not load: /member renders for
            // everyone, so nobody lands on a page they cannot use.
          }
        }
        router.push(destination);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (magicLinkSent) {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Check Your Email</h2>
        <p className="text-gray-600">
          We sent a magic link to <strong>{email}</strong>. Click the link in the email
          to sign in.
        </p>
        <button
          type="button"
          className="btn-secondary mt-6 w-full"
          onClick={() => {
            setMagicLinkSent(false);
            setMagicLinkMode(false);
          }}
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">Sign In</h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input w-full"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {!magicLinkMode && (
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input w-full"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading
            ? 'Please wait...'
            : magicLinkMode
              ? 'Send Magic Link'
              : 'Sign In'}
        </button>
      </form>

      <div className="mt-4">
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => {
            setMagicLinkMode(!magicLinkMode);
            setError('');
          }}
        >
          {magicLinkMode ? 'Use Password Instead' : 'Send Magic Link'}
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don&apos;t have an account?{' '}
        <Link href={`/register${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}`} className="font-medium text-blue-600 hover:text-blue-500">
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
