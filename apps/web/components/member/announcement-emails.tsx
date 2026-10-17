'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether this member gets announcements an organiser emails (CMN-21).
 *
 * The way back in as much as the way out. The unsubscribe link at the foot
 * of an announcement switches this off; without somewhere to switch it on
 * again, a press made in a crowded inbox would be permanent.
 *
 * **Read before it is shown.** A member who stopped announcements from an
 * email and then found this ticked would reasonably conclude the link did
 * nothing — and the next thing they press is not a link.
 */
export function AnnouncementEmails() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token || !orgId) return;

    api.commons
      .announcementEmails(orgId, token)
      .then((current) => {
        if (!cancelled) setOn(current.announcementEmails);
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
      const saved = await api.commons.setAnnouncementEmails(orgId, next, token);
      setOn(saved.announcementEmails);
    } catch {
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="announcement-emails">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        Announcements from your organizers
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
          Email me when organizers send something to everyone
          <span className="block text-[var(--text-secondary)]">
            The occasional notice an organizer chooses to send to the whole community — a
            change of plan, a reminder about something happening. It&rsquo;s posted in the
            Commons either way.
          </span>
        </span>
      </label>
    </section>
  );
}
