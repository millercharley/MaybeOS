'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Everything MaybeOS might email this member, in one place (UI-03).
 *
 * These arrived one at a time — the monthly recap, then messages, then the
 * weekly summary, then announcements — and each was a card of its own,
 * consistent with the last and sensible on its own. Four cards later a member
 * scrolling their profile met four nearly identical boxes and had to read all
 * of them to find the one they wanted. Charley: "consolidate the member email
 * preferences into one card."
 *
 * The rows are independent on purpose. One switch for "email me" would be
 * easier to build and would make the common choice — I want to know when
 * somebody writes to me, I do not want a weekly summary — impossible to
 * express.
 *
 * **Each setting is read before it is shown.** A member who turned one off
 * from the footer of an email and then found it ticked would reasonably
 * conclude the link did nothing, and the next thing they press is not a link.
 */

interface Row {
  key: string;
  label: string;
  description: string;
  /** Null until the server answers; the row is not drawn before then. */
  on: boolean | null;
  /** False when this co-op's plan does not include the email at all. */
  available: boolean;
}

const COPY: Record<string, { label: string; description: string }> = {
  messages: {
    label: 'When somebody writes to me',
    description:
      'Sent as soon as a member messages you, with what they wrote. You only get one until you have read it, so a conversation does not fill your inbox.',
  },
  announcements: {
    label: 'Announcements from organizers',
    description:
      'The occasional notice an organizer sends to the whole community — a change of plan, a reminder about something happening. It is posted in the Commons either way.',
  },
  commonsDigest: {
    label: 'What I missed in the Commons',
    description:
      'A weekly summary, and only in a week you did not come in at all. Read the Commons and it does not arrive.',
  },
  radar: {
    label: 'Gatherings I might like',
    description:
      'The weekly Radar digest: what is coming up that matches what you are interested in.',
  },
  recap: {
    label: 'What the month added up to',
    description:
      'Once a month, if your organizers send one: who joined, what was on, and what the co-op got done.',
  },
};

export function EmailPreferences() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !orgId) return;

    /*
      All five asked at once, and each allowed to fail on its own.

      The monthly recap belongs to a plan a co-op may not be on, and its
      endpoint answers accordingly. One missing setting must not cost a
      member the other four — which is what a single `await` chain would do.
    */
    const asked = await Promise.allSettled([
      api.commons.messageEmails(orgId, token),
      api.commons.announcementEmails(orgId, token),
      api.commons.digestEmails(orgId, token),
      api.radar.myInterests(orgId, token),
      api.recap.emails(orgId, token),
    ]);

    const value = <T,>(r: PromiseSettledResult<T>, read: (v: T) => boolean) =>
      r.status === 'fulfilled'
        ? { on: read(r.value), available: true }
        : { on: null, available: false };

    setRows([
      { key: 'messages', ...COPY.messages, ...value(asked[0], (v) => v.messageEmails) },
      { key: 'announcements', ...COPY.announcements, ...value(asked[1], (v) => v.announcementEmails) },
      { key: 'commonsDigest', ...COPY.commonsDigest, ...value(asked[2], (v) => v.commonsDigestEmails) },
      { key: 'radar', ...COPY.radar, ...value(asked[3], (v) => v.radarEmails) },
      { key: 'recap', ...COPY.recap, ...value(asked[4], (v) => v.recapEmails) },
    ]);
  }, [orgId, token]);

  useEffect(() => {
    load().catch(() => setError('Could not load your email settings.'));
  }, [load]);

  async function set(key: string, next: boolean) {
    if (!token || !orgId || busy) return;
    setBusy(key);
    setError('');

    try {
      // The saved value, not the clicked one: echoing the click would show
      // "off" even when the save failed.
      const saved = await save(key, next);
      setRows((current) => current.map((r) => (r.key === key ? { ...r, on: saved } : r)));
    } catch {
      setError('That did not save. Your settings are unchanged.');
    } finally {
      setBusy(null);
    }
  }

  async function save(key: string, next: boolean): Promise<boolean> {
    switch (key) {
      case 'messages':
        return (await api.commons.setMessageEmails(orgId!, next, token!)).messageEmails;
      case 'announcements':
        return (await api.commons.setAnnouncementEmails(orgId!, next, token!)).announcementEmails;
      case 'commonsDigest':
        return (await api.commons.setDigestEmails(orgId!, next, token!)).commonsDigestEmails;
      case 'radar':
        return (await api.radar.setEmails(orgId!, next, token!)).radarEmails;
      default:
        return (await api.recap.setEmails(orgId!, next, token!)).recapEmails;
    }
  }

  const shown = rows.filter((r) => r.available && r.on !== null);
  if (!token || !orgId || shown.length === 0) return null;

  return (
    <section className="card" id="email-preferences">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">Email</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        What your co-op may send you. Turning one off leaves the others alone — and none of
        this changes what you see inside MaybeOS.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 divide-y divide-[var(--border)]">
        {shown.map((row) => (
          <label key={row.key} className="flex items-start gap-3 py-3">
            <input
              type="checkbox"
              checked={row.on === true}
              disabled={busy === row.key}
              onChange={(e) => set(row.key, e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-[var(--text-primary)]">
              {row.label}
              <span className="block text-[var(--text-secondary)]">{row.description}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
