'use client';

import { useState } from 'react';
import { Org, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Telling an imported roster how to get in (MEM-18).
 *
 * The migration send, and the only way to reach these people: an invitation
 * is refused for anybody who already has a membership, and after a CSV
 * import they all do. Each member here has an account with no password and
 * has belonged to the co-op for years.
 *
 * **Shows who it will write to before it writes to any of them.** The habit
 * the Stripe adoption scan established — look at the list of real people
 * first — because this is the one action in MaybeOS that lands in hundreds
 * of inboxes at once and cannot be taken back.
 */
export function SignInLinks({ org }: { org: Org }) {
  const token = useAuthStore((s) => s.token);
  const [waiting, setWaiting] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sentTotal, setSentTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  async function look() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.members.sendSignInLinks(org.id, { dryRun: true }, token);
      setWaiting(result.recipients);
      setRemaining(result.remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setConfirming(false);
    try {
      const result = await api.members.sendSignInLinks(org.id, {}, token);
      setSentTotal((n) => n + result.sent);
      setRemaining(result.remaining);
      // Re-read, so the list shows who is left rather than who just went.
      const next = await api.members.sendSignInLinks(org.id, { dryRun: true }, token);
      setWaiting(next.recipients);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send');
    } finally {
      setBusy(false);
    }
  }

  const none = waiting !== null && waiting.length === 0;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Sign-in links for imported members</h2>
        <p className="mt-1 max-w-prose text-sm text-gray-500">
          Somebody brought in by a spreadsheet import already has an account and has never
          needed a password — so they can&rsquo;t be invited, and nothing has told them
          MaybeOS exists. This emails them a link that signs them straight in, in your words:
          Settings &rarr; the <strong>Sign-in</strong> email.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          The link lasts {org.inviteExpiryDays ?? 7} days, which you can change above. It goes
          out in batches — as many as fit in one go — so press again until nobody is left.
          Nobody is written to twice, however many times you press.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {sentTotal > 0 && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          Sent to {sentTotal} member{sentTotal === 1 ? '' : 's'} so far.
          {remaining
            ? ` ${remaining} still waiting — press again, and keep going until this says nobody is left.`
            : ' Nobody left waiting — everybody has their link.'}
        </div>
      )}

      {waiting === null ? (
        <button type="button" onClick={look} disabled={busy} className="btn-secondary text-sm">
          {busy ? 'Looking…' : 'See who is waiting'}
        </button>
      ) : none ? (
        <p className="text-sm text-gray-500">
          Nobody is waiting. Everyone who has an account has either signed in or already been
          sent a link.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-gray-200">
            <p className="border-b border-gray-100 px-3 py-2 text-sm font-medium text-gray-900">
              {remaining} member{remaining === 1 ? '' : 's'} waiting
              {remaining && remaining > waiting.length ? ` — the next ${waiting.length} in line` : ''}
            </p>
            <ul className="max-h-48 overflow-y-auto px-3 py-2 text-sm text-gray-600">
              {waiting.map((email) => (
                <li key={email} className="truncate py-0.5">
                  {email}
                </li>
              ))}
            </ul>
          </div>

          {confirming ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                {/*
                  Not a number (MEM-23). One press sends as many as fit in the
                  few seconds a request is allowed, which is a few dozen —
                  promising a hundred and delivering twenty-six is how an
                  admin concludes the thing is broken when it is working.
                */}
                This starts writing to the {remaining} {remaining === 1 ? 'person' : 'people'}{' '}
                waiting, as many as it can reach in one go, and it cannot be unsent. Each one gets
                a link that signs them in.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={send} disabled={busy} className="btn-primary text-sm">
                  {busy ? 'Sending…' : 'Yes, start sending'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="btn-secondary text-sm"
                >
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className="btn-primary text-sm"
              >
                Send the next batch
              </button>
              <button type="button" onClick={look} disabled={busy} className="btn-secondary text-sm">
                Look again
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
