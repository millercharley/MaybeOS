'use client';

import { FormEvent, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

/**
 * Change your own password (AUTH-03).
 *
 * There was no way to do this anywhere in MaybeOS — no screen, no endpoint,
 * and no forgot-password either. A password set at registration was permanent.
 *
 * That stopped being a mere annoyance when SEC-08 exposed every stored hash to
 * anyone holding a public key: the one credential that had been disclosed was
 * also the one nobody could rotate.
 *
 * **Changing one asks for the current one**, because a borrowed browser
 * should not be enough to take an account permanently.
 *
 * **Creating a first one cannot ask**, and that is AUTH-04. Everybody who
 * arrived through a sign-in link has no password — 433 of MaybeItsFate's 439
 * members — and this screen asked every one of them to prove a password they
 * had never had, then refused them with "this account has no password set, so
 * there is nothing to change". The field is gone when there is nothing to put
 * in it, and the words change with it: creating a password is not changing
 * one, and a form that says otherwise is a form people assume is not for
 * them.
 *
 * The API tells the owner by email either way, which is what stands in for
 * the current-password check when there is none to make.
 */
export function ChangePassword() {
  const token = useAuthStore((s) => s.token);

  /** null while we do not yet know which form this is. */
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.auth
      .profile(token)
      // Assume there is one if we cannot tell: asking for a password that
      // exists is a nuisance, and silently not asking for one that does is
      // a hole.
      .then((me) => setHasPassword(me.hasPassword ?? true))
      .catch(() => setHasPassword(true));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setFailed(false);

    if (next.length < 8) {
      setFailed(true);
      return setMessage('Use at least 8 characters.');
    }
    if (next !== confirm) {
      // Caught here rather than at the API, which never sees the confirmation
      // field — a mistyped repeat should not cost a round trip.
      setFailed(true);
      return setMessage('The two new passwords do not match.');
    }

    setBusy(true);
    try {
      const { created } = await api.auth_password.change(
        { ...(hasPassword ? { currentPassword: current } : {}), newPassword: next },
        token as string,
      );
      setCurrent('');
      setNext('');
      setConfirm('');
      setHasPassword(true);
      setMessage(
        created
          ? 'Password created. You can sign in with it, or keep using a sign-in link.'
          : 'Password changed.',
      );
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : 'Could not change it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
        <KeyRound className="h-4 w-4" />
        {hasPassword === false ? 'Create a password' : 'Password'}
      </h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {hasPassword === false
          ? 'You sign in with a link emailed to you. Add a password and you can use either.'
          : 'Changing this signs out anything holding a sign-in link for your account.'}
      </p>

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            failed ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}
          role="alert"
        >
          {message}
        </p>
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
        {/* Only when there is one to give (AUTH-04). */}
        {hasPassword !== false && (
          <div>
            <label htmlFor="current-password" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input w-full"
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
              {hasPassword === false ? 'Password' : 'New password'}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
              Repeat it
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        <p className="text-xs text-[var(--text-tertiary)]">
          At least 8 characters. Length matters more than punctuation — it is what
          makes a stolen password file expensive to crack.
        </p>

        <div className="flex justify-end border-t border-[var(--border)] pt-4">
          {/* `current` is only required when there is one (AUTH-04) — demanding
              it here would have left the button dead for every member who
              signs in with a link. */}
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !next || (hasPassword !== false && !current)}
          >
            {busy
              ? hasPassword === false
                ? 'Creating...'
                : 'Changing...'
              : hasPassword === false
                ? 'Create password'
                : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}
