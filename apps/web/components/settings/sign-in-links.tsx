'use client';

import { useState } from 'react';
import { Org, ResendScope, SignInAudit, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  auditHeadline,
  auditRefusal,
  bounceIsFixable,
  checkedWhen,
  cohortTitle,
  cohorts,
  looksLikeAQuotaWall,
} from '@/lib/sign-in-audit';

/**
 * Telling an imported roster how to get in, and checking that it worked
 * (MEM-18, MEM-25).
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
 *
 * **And shows what the provider actually did with them.** The first real send
 * is why: Postmark's plan stopped accepting at a hundred messages, MaybeOS
 * marked four hundred and thirty-five, and this panel reported that nobody was
 * left waiting. It was reading its own marks, which are written before the
 * provider is called. Three hundred and thirty-five people were recorded as
 * told and had an empty inbox, and there was no screen anywhere that could
 * tell them from the hundred who were fine.
 */
export function SignInLinks({ org }: { org: Org }) {
  const token = useAuthStore((s) => s.token);
  const [waiting, setWaiting] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sentTotal, setSentTotal] = useState(0);
  const [failedTotal, setFailedTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<ResendScope | null>(null);
  const [audit, setAudit] = useState<SignInAudit | null>(null);

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

  async function check() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      setAudit(await api.members.auditSignInLinks(org.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That check did not run');
    } finally {
      setBusy(false);
    }
  }

  async function send(scope: ResendScope) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setConfirming(null);
    try {
      const result = await api.members.sendSignInLinks(org.id, { scope }, token);
      setSentTotal((n) => n + result.sent);
      setFailedTotal((n) => n + result.failed);

      // Re-check, so the numbers on screen are the provider's and not ours.
      // Sending changes who is in which group, and the group this press was
      // for is the one most likely to still have people in it.
      setAudit(await api.members.auditSignInLinks(org.id, token));

      if (scope === 'waiting') {
        const next = await api.members.sendSignInLinks(org.id, { dryRun: true }, token);
        setWaiting(next.recipients);
        setRemaining(next.remaining);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send');
    } finally {
      setBusy(false);
    }
  }

  async function addressFixed(userId: string) {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.members.clearSignInBounce(org.id, userId, token);
      setAudit(await api.members.auditSignInLinks(org.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  const none = waiting !== null && waiting.length === 0;
  const refusal = audit ? auditRefusal(audit) : null;
  const groups = audit ? cohorts(audit) : [];

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
          {failedTotal > 0 && (
            <>
              {' '}
              {/*
                Said out loud, because a refusal puts the member straight back
                in the queue and an admin watching the same number twice is
                owed the reason (MEM-25).
              */}
              Your provider refused {failedTotal} — those members are back in the queue, and
              pressing again will try them once more. If the number does not move, the provider
              is turning them down, usually a monthly sending limit.
            </>
          )}
        </div>
      )}

      {/* ── What the provider actually did (MEM-25) ── */}
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <h3 className="text-sm font-semibold text-gray-900">What actually arrived</h3>
            <p className="mt-1 text-sm text-gray-500">
              MaybeOS records that it tried to send, which it has to do before handing the
              message over. It is not proof of delivery, and when a provider turns messages
              down — a monthly limit, most often — the two part company silently. This asks your
              email provider what it really did.
            </p>
          </div>
          <button type="button" onClick={check} disabled={busy} className="btn-secondary text-sm">
            {busy ? 'Checking…' : audit ? 'Check again' : 'Check with the provider'}
          </button>
        </div>

        {refusal && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{refusal}</div>
        )}

        {audit?.checked && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{auditHeadline(audit)}</p>
              {checkedWhen(audit) && (
                <p className="mt-0.5 text-xs text-gray-400">Checked {checkedWhen(audit)}</p>
              )}
            </div>

            {looksLikeAQuotaWall(audit) && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Most of those messages were never accepted, which almost always means a monthly
                sending limit on your email provider&rsquo;s plan. Raise the limit before sending
                again, or the same thing will happen to the same people.
              </div>
            )}

            {audit.beyondRetention && (
              <p className="text-sm text-gray-500">
                That send is old enough that your provider may no longer keep records of it, so
                treat &ldquo;never actually sent&rdquo; with some caution here.
              </p>
            )}

            {groups.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nobody needs an email. Everyone has either been reached or has signed in.
              </p>
            ) : (
              <ul className="space-y-3">
                {groups.map((cohort) => (
                  <li
                    key={cohort.scope}
                    className={`rounded-lg border p-3 ${
                      cohort.urgent ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900">{cohortTitle(cohort)}</p>
                    <p className="mt-1 max-w-prose text-sm text-gray-600">{cohort.because}</p>

                    {confirming === cohort.scope ? (
                      <div className="mt-3">
                        <p className="text-sm text-amber-900">
                          This starts writing to {cohort.count}{' '}
                          {cohort.count === 1 ? 'person' : 'people'}, as many as it can reach in
                          one go, and it cannot be unsent.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => send(cohort.scope)}
                            disabled={busy}
                            className="btn-primary text-sm"
                          >
                            {busy ? 'Sending…' : 'Yes, start sending'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            disabled={busy}
                            className="btn-secondary text-sm"
                          >
                            Not yet
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(cohort.scope)}
                        disabled={busy}
                        className="btn-secondary mt-3 text-sm"
                      >
                        {cohort.action}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {audit.bounced.length > 0 && (
              <div className="rounded-lg border border-red-200">
                <div className="border-b border-red-100 px-3 py-2">
                  <p className="text-sm font-medium text-gray-900">
                    {audit.bounced.length} address
                    {audit.bounced.length === 1 ? '' : 'es'} to fix
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    These came back. Re-sending cannot help until the address changes, so they
                    are left out of every group above.
                  </p>
                </div>
                <ul className="divide-y divide-red-50">
                  {audit.bounced.map((member) => (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-gray-900">
                          {member.name ?? member.email}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {member.email} — {member.kind}
                        </p>
                      </div>
                      {bounceIsFixable(member.kind) && (
                        <button
                          type="button"
                          onClick={() => addressFixed(member.userId)}
                          disabled={busy}
                          className="btn-secondary shrink-0 text-xs"
                        >
                          Address fixed, try again
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {waiting === null ? (
        <button type="button" onClick={look} disabled={busy} className="btn-secondary text-sm">
          {busy ? 'Looking…' : 'See who is waiting'}
        </button>
      ) : none ? (
        <p className="text-sm text-gray-500">
          Nobody is waiting to be written to for the first time. Whether they received anything
          is a different question — that is what the check above answers.
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

          {confirming === 'waiting' ? (
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
                <button
                  type="button"
                  onClick={() => send('waiting')}
                  disabled={busy}
                  className="btn-primary text-sm"
                >
                  {busy ? 'Sending…' : 'Yes, start sending'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
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
                onClick={() => setConfirming('waiting')}
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
