'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { landingPathFor } from '@/lib/landing';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only an explicit ?redirect is honoured; where a bare registration lands
  // depends on who registered. This defaulted to /admin, so somebody who had
  // just created an account was shown "This page is for organisers" — the same
  // bug fixed on the login page, left behind here.
  const redirectTo = searchParams.get('redirect');
  const setToken = useAuthStore((s) => s.setToken);

  const [name, setName] = useState('');
  // Prefilled from an invitation (MEM-04), so an invitee does not retype the
  // address they were invited at — and does not accidentally register a
  // different one.
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.auth.register({ name, email, password });
      setToken(result.accessToken);
      let destination = redirectTo ?? '/member';
      if (!redirectTo) {
        try {
          const user = await api.auth.profile(result.accessToken);
          destination = landingPathFor(user, localStorage.getItem('maybeos_org'));
        } catch {
          // Registered, but the profile would not load. /member renders for
          // everyone, so nobody lands on a page they cannot use.
        }
      }
      router.push(destination);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">
        Create Account
      </h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            className="input w-full"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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
            placeholder="Choose a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link
          href={`/login${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ''}${
            email ? `${redirectTo ? '&' : '?'}email=${encodeURIComponent(email)}` : ''
          }`}
          className="font-medium text-blue-600 hover:text-blue-500"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
