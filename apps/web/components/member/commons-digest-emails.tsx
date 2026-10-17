'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether this member gets the weekly summary of what they missed (CMN-20).
 *
 * Worth saying plainly on the page: this one only ever arrives when they
 * have been away. A member who reads the Commons never sees it whatever this
 * is set to, and somebody who does not know that will read "weekly email" and
 * switch it off out of caution.
 *
 * **Read before it is shown**, not assumed from the schema default — a
 * member who stopped it from the footer of one and then found the box ticked
 * would reasonably conclude the link did nothing.
 */
export function CommonsDigestEmails() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) return;

    api.commons
      .digestEmails(orgId, token)
      .then((current) => {
        if (!cancelled) setOn(current.commonsDigestEmails);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, token]);

  if (!token || !orgId || unavailable || on === null) return null;

  async function set(next: boolean) {
    if (!token || !orgId || busy) return;
    setBusy(true);
    try {
      const saved = await api.commons.setDigestEmails(orgId, next, token);
      setOn(saved.commonsDigestEmails);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="commons-digest-emails">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        What you missed in the Commons
      </h2>

      <label className="mt-3 flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => set(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-[var(--text-primary)]">
          Email me a weekly summary when I&rsquo;ve been away
          <span className="block text-[var(--text-secondary)]">
            Only sent in a week you didn&rsquo;t come in at all. Read the Commons and it
            doesn&rsquo;t arrive — there&rsquo;s nothing to catch up on.
          </span>
        </span>
      </label>
    </section>
  );
}
