'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether this member hears about a message waiting for them (CMN-19).
 *
 * On by default, and the only one of MaybeOS's emails that is sent because a
 * person addressed this member by name. Until now nothing was sent at all: a
 * member found out they had been written to if, and only if, they happened to
 * come back and look.
 *
 * **The setting is read before it is shown**, not assumed from the schema
 * default. A member who turned these off from the footer of one and then
 * opened their profile would otherwise find the box ticked — the product
 * contradicting a choice they had already made, which is the fastest way to
 * make an unsubscribe link look like it did nothing.
 */
export function MessageEmails() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) return;

    api.commons
      .messageEmails(orgId, token)
      .then((current) => {
        if (!cancelled) setOn(current.messageEmails);
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
      const saved = await api.commons.setMessageEmails(orgId, next, token);
      setOn(saved.messageEmails);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="message-emails">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        When somebody writes to you
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
          Email me when I get a message
          <span className="block text-[var(--text-secondary)]">
            Sent as soon as somebody messages you, with what they wrote. You&rsquo;ll only get
            one until you&rsquo;ve read it, so a conversation doesn&rsquo;t fill your inbox.
            Turning this off leaves the rest of your community&rsquo;s email alone.
          </span>
        </span>
      </label>
    </section>
  );
}
