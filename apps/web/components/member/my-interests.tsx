'use client';

import { useEffect, useState } from 'react';
import { MyInterests as MyInterestsData, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Everything this co-op knows about what a member is interested in (RDR-01),
 * on their own profile, where they can change any of it.
 *
 * **Including what MaybeOS guessed.** An interest inferred from RSVPs is
 * shown in the same list as one the member picked, labelled as a guess and
 * overrulable with one tap. The alternative — matching on a hidden profile
 * built from behaviour — is the thing that makes software like this feel
 * like surveillance, and it is not worth the two lines it saves.
 *
 * Nobody else sees this. There is no route that returns one member's
 * interests to another member or to an organiser; an admin sees counts.
 */
export function MyInterests() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [data, setData] = useState<MyInterestsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) return;

    api.radar
      .myInterests(orgId, token)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        // Radar may simply not be part of this co-op's plan. A profile page
        // should not grow an error box about a feature nobody asked for.
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, token]);

  if (!token || !orgId || !data || data.interests.length === 0) return null;

  async function set(tagId: string, declared: boolean | null) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    setError('');
    try {
      setData(await api.radar.setInterests(orgId, [{ tagId, declared }], token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  async function setEmails(on: boolean) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.radar.setEmails(orgId, on, token);
      setData((current) => (current ? { ...current, radarEmails: next.radarEmails } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="interests">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">Interests</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        What you&rsquo;d like to hear about. Only you can see this.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-2">
        {data.interests.map((interest) => (
          <li key={interest.tagId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--text-primary)]">
              <span aria-hidden className="mr-2">
                {interest.emoji ?? '•'}
              </span>
              {interest.name}
              {/* The guess, said out loud. A member who disagrees can say so
                  on the same line they read it. */}
              {interest.declared === null && interest.rsvpCount > 0 && (
                <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                  you&rsquo;ve been to {interest.rsvpCount}
                </span>
              )}
            </span>

            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                aria-pressed={interest.declared === true}
                disabled={busy}
                onClick={() => set(interest.tagId, interest.declared === true ? null : true)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  interest.declared === true
                    ? 'border-transparent bg-[var(--text-primary)] text-[var(--surface)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Interested
              </button>
              <button
                type="button"
                aria-pressed={interest.declared === false}
                disabled={busy}
                onClick={() => set(interest.tagId, interest.declared === false ? null : false)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  interest.declared === false
                    ? 'border-transparent bg-[var(--surface-sunken)] font-medium'
                    : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Not for me
              </button>
            </span>
          </li>
        ))}
      </ul>

      <label className="mt-5 flex items-start gap-3 border-t border-[var(--border)] pt-4">
        <input
          type="checkbox"
          checked={data.radarEmails}
          disabled={busy}
          onChange={(e) => setEmails(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-[var(--text-primary)]">
          Email me when something matching comes up
          <span className="block text-[var(--text-secondary)]">
            At most once a week, and never about anything you&rsquo;ve marked &ldquo;not for
            me&rdquo;. Turning this off leaves the rest of your community&rsquo;s email alone.
          </span>
        </span>
      </label>
    </section>
  );
}
