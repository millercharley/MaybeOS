'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether this member wants the monthly recap (RCP-01), on their own profile.
 *
 * Its own switch rather than a line under Radar's: the two emails are
 * different things at different rhythms, and a member who does not want a
 * weekly digest of what is coming up may well want the letter saying what the
 * month was. One switch for both would mean choosing for them.
 *
 * **The setting is read before it is shown**, rather than assumed from the
 * schema default. A member who unsubscribed from the footer of last month's
 * recap and then opens their profile would otherwise find the box ticked —
 * the product contradicting a choice they had already made, which is the
 * fastest way to make an unsubscribe link look like it did nothing.
 */
export function RecapEmails() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // The recap is part of Plus and Unlimited, so a co-op on Free has nothing
  // behind this switch. A profile page should not grow an error box about a
  // feature nobody asked for — the same bargain `MyInterests` makes.
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) return;

    api.recap
      .emails(orgId, token)
      .then((current) => {
        if (!cancelled) setOn(current.recapEmails);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, token]);

  // Nothing until the real setting is known: a box that renders ticked and
  // then flips is the same lie, told faster.
  if (!token || !orgId || unavailable || on === null) return null;

  async function set(next: boolean) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      const saved = await api.recap.setEmails(orgId, next, token);
      setOn(saved.recapEmails);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="recap-emails">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">The monthly recap</h2>

      <label className="mt-3 flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => set(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-[var(--text-primary)]">
          Email me what the month added up to
          <span className="block text-[var(--text-secondary)]">
            Once a month, if your organizers send one: who joined, what was on, and what the
            co-op got done. Turning this off leaves the rest of your community&rsquo;s email
            alone.
          </span>
        </span>
      </label>
    </section>
  );
}
