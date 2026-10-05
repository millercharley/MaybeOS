'use client';

import { useState } from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Where "View all events" sends somebody (PUB-05).
 *
 * Charley: "Ask the admin for the link on the Join Page tab in the Admin
 * Settings. If the URL entry is left blank, show a single page of events that
 * do not require a logged in user to view, RSVP, and buy tickets."
 *
 * So blank is a real answer rather than an unfinished one, and the field says
 * what blank does. A co-op that has built a calendar on their own site puts
 * its address here; everybody else leaves it alone and gets the page MaybeOS
 * hosts, which needs no account for any of the three things.
 */
export function PublicEventsLink({ org }: { org: Org }) {
  const token = useAuthStore((s) => s.token);
  const [value, setValue] = useState(org.publicEventsUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const origin = typeof window === 'undefined' ? 'https://maybeos.org' : window.location.origin;
  const ours = `${origin}/orgs/${org.slug}/events`;
  const current = value.trim();

  async function save() {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      // Empty means "use ours", and null is how that is stored — an empty
      // string would be a URL of no length rather than an absent one.
      await api.orgs.update(org.id, { publicEventsUrl: current || null }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Where &ldquo;View all events&rdquo; goes
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          On your join page and in the website embed. Leave this blank and it goes to the events
          page MaybeOS hosts for you — anyone can read it, RSVP and buy a ticket there without an
          account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          inputMode="url"
          className="input min-w-[18rem] flex-1"
          placeholder={ours}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" onClick={save} disabled={saving} className="btn-secondary text-sm">
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <p className="text-sm text-gray-500">
        {current ? (
          <>
            People will be sent to <span className="font-mono text-xs">{current}</span>.
          </>
        ) : (
          <>
            People will be sent to{' '}
            <a
              href={ours}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700"
            >
              your MaybeOS events page
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </>
        )}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
