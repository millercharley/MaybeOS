'use client';

import { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

/**
 * "I forgot my password", step one (AUTH-09).
 *
 * Charley: "Add a button for a member to reset their password on the login
 * screen. Provide the full path of sending a confirmation email, that links to
 * a form to create a new password." This is the first of the two screens; the
 * form the email links to is `reset-password/new`.
 *
 * **The confirmation is the same either way.** An address with an account and
 * an address without one get the same sentence, because the API answers
 * identically on purpose — a screen that said "no account with that address"
 * would undo the enumeration resistance the endpoint was written to have, and
 * hand anybody a way to ask MaybeOS who its members are.
 *
 * That has a cost worth being honest about on screen rather than hiding: a
 * member who mistypes their address waits for an email that is never coming.
 * So the confirmation names the address it used, which is the one thing that
 * lets them spot the typo themselves, and offers to go back and change it.
 */
function RequestReset() {
  const searchParams = useSearchParams();
  // Carried from the login screen, so somebody who had already typed their
  // address does not type it again.
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.auth.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      /*
        Only a network or rate-limit failure can land here — the endpoint
        answers 200 for an unknown address by design. Shown rather than
        swallowed: "nothing happened" is the one outcome a member cannot act
        on, and being told they asked too many times is actionable.
      */
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Check your email</h2>
        <p className="text-gray-600">
          If <strong>{email}</strong> has an account, a link to set a new password is on
          its way. It works once and expires in an hour.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          Nothing arrived? Check the address above for a typo, and look in your spam
          folder.
        </p>

        <button
          type="button"
          className="btn-secondary mt-6 w-full"
          onClick={() => setSent(false)}
        >
          Use a different address
        </button>
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">
        Reset your password
      </h2>
      <p className="mb-6 text-center text-sm text-gray-600">
        We&apos;ll email you a link to set a new one.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input w-full"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Sending...' : 'Email me a link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      }
    >
      <RequestReset />
    </Suspense>
  );
}
