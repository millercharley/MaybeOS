'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { safeRedirect } from '@/lib/safe-redirect';
import { landingPathFor } from '@/lib/landing';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only an explicit ?redirect is honoured; where a bare registration lands
  // depends on who registered. This defaulted to /admin, so somebody who had
  // just created an account was shown "This page is for organisers" — the same
  // bug fixed on the login page, left behind here.
  // Only a path inside this app: the value goes to `router.push`, which will
  // leave the site for an absolute or protocol-relative URL (AUTH-08).
  const redirectTo = safeRedirect(searchParams.get('redirect'), '');
  const setToken = useAuthStore((s) => s.setToken);

  const [name, setName] = useState('');
  // Prefilled from an invitation (MEM-04), so an invitee does not retype the
  // address they were invited at — and does not accidentally register a
  // different one.
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /*
    Registering may now end in an email rather than a session (AUTH-10).

    An address nobody has proved no longer gets signed in on the spot — that
    is what a bot was using, two or three accounts a week since October. The
    one exception is an invitation, which was emailed to the address and so
    proves it; those people are signed in exactly as before and never see
    this state.
  */
  const [checkEmail, setCheckEmail] = useState('');
  // Carried from the invitation that sent them here, so an invitee is not
  // asked to go and find a second email.
  const inviteToken = searchParams.get('invite') ?? undefined;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await api.auth.register({ name, email, password, inviteToken });

      if (!('accessToken' in result)) {
        setCheckEmail(result.email);
        return;
      }

      setToken(result.accessToken);
      let destination = redirectTo || '/member';
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

  /*
    Where somebody lands when the address still has to be proved.

    Says the address back to them, because the commonest reason an email
    never arrives is a typo in the one they just typed — and a screen that
    only says "check your email" gives them nothing to check against
    (DESIGN §7). The way back is the ordinary sign-in link request, which is
    the same mechanism, so there is no second thing to maintain.
  */
  if (checkEmail) {
    return (
      <div>
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900">
          Check your email
        </h2>
        <p className="text-center text-sm text-gray-600">
          We have sent a link to <strong>{checkEmail}</strong>. Opening it finishes
          setting up your account and signs you in.
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          Nothing arrived? It can take a minute, and it may be in spam. If the
          address above is wrong,{' '}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            start again
          </Link>
          , or{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            ask for a new link
          </Link>
          .
        </p>
      </div>
    );
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
