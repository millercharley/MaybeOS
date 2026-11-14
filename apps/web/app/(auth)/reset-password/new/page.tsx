'use client';

import { useEffect, useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { MIN_PASSWORD } from '@/lib/password-rules';

/**
 * The form the emailed link opens (AUTH-09).
 *
 * **The link is checked before the form is shown.** Asking somebody to think
 * of a password, type it twice, and only then be told the link expired forty
 * minutes ago is the version of this screen that makes people give up. One
 * request answers it, and the check needs the token to ask, so it tells a
 * holder nothing that redeeming would not have.
 *
 * **No session is handed out at the end.** Setting a password sends them to
 * sign in with it, rather than signing them in here. Two reasons: proving they
 * know the password they just chose is the point of having one, and a leaked
 * link cannot then be turned straight into a session — an attacker would have
 * to set a password, which is the loudest thing they could do, because the
 * `password-set` notice reaches the real owner either way.
 *
 * **Typed twice**, because there is no "current password" to fall back on if
 * the one thing they typed had a typo in it. That is the whole difference
 * between this screen and the one in settings.
 */
function NewPassword() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<'checking' | 'ready' | 'dead' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('dead');
      return;
    }
    let current = true;
    api.auth
      .checkPasswordReset(token)
      .then((answer) => {
        if (current) setState(answer.usable ? 'ready' : 'dead');
      })
      .catch(() => {
        /*
          A failed check is not a dead link.

          Treating a network blip as expiry would send somebody back to request
          another email they did not need. The form opens and the redemption
          below is the real gate — it refuses an expired token on its own.
        */
        if (current) setState('ready');
      });
    return () => {
      current = false;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    // Checked here as well as by the API, so a mismatch costs no round trip
    // and no rate-limit budget.
    if (password !== again) {
      setError('Those two passwords are not the same.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setSaving(true);
    try {
      await api.auth.resetPassword(token, password);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'checking') {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (state === 'dead') {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">That link has expired</h2>
        <p className="text-gray-600">
          Reset links work once and last an hour. Ask for a new one and it will be in
          your inbox in a moment.
        </p>
        <Link href="/reset-password" className="btn-primary mt-6 inline-block w-full">
          Send me a new link
        </Link>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Your password is set</h2>
        <p className="text-gray-600">Sign in with it and you&apos;re back in.</p>
        <button
          type="button"
          className="btn-primary mt-6 w-full"
          onClick={() => router.push('/login')}
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">
        Choose a new password
      </h2>
      <p className="mb-6 text-center text-sm text-gray-600">
        At least {MIN_PASSWORD} characters. Longer is better than complicated.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="new-password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            New password
          </label>
          <input
            id="new-password"
            type="password"
            // So a password manager offers to generate and then to save one,
            // rather than autofilling the old password into a field asking for
            // its replacement.
            autoComplete="new-password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD}
          />
        </div>

        <div>
          <label
            htmlFor="new-password-again"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            And again
          </label>
          <input
            id="new-password-again"
            type="password"
            autoComplete="new-password"
            className="input w-full"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            required
            minLength={MIN_PASSWORD}
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? 'Saving...' : 'Set my password'}
        </button>
      </form>
    </div>
  );
}

export default function NewPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      }
    >
      <NewPassword />
    </Suspense>
  );
}
