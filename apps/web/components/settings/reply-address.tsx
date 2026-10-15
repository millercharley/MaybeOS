'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Org, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Where a member's reply goes (EML-03).
 *
 * Every MaybeOS message was no-reply mail by construction — `noreply@` with
 * no `Reply-To` — so a member who answered one was answering nobody at all.
 * That is discourteous, and it is also a small negative signal to the filters
 * deciding whether this domain belongs to anybody real, which is a live
 * question for this co-op.
 *
 * Blank is a real answer and the default. A co-op with nobody to read replies
 * is better served by no reply address: the member's own mail client then
 * says so immediately, which beats writing to silence.
 */
export function ReplyAddress({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const token = useAuthStore((s) => s.token);
  const saved = org.replyToEmail ?? '';

  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Follow the server when it changes underneath — another organiser, or a
  // refetch after this very save.
  useEffect(() => setValue(org.replyToEmail ?? ''), [org.replyToEmail]);

  const changed = value.trim() !== saved;

  async function save() {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      /*
        An emptied field means "no replies", which must reach the server as
        null rather than as an empty string — the API normalises it, and
        sending the difference keeps the two ends honest about which one is
        deciding.
      */
      await api.orgs.update(org.id, { replyToEmail: value.trim() || null }, token);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Replies to your emails</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            When a member replies to an email from {org.name}, this is where it lands. Leave it
            blank and your emails are no-reply: a member who tries to answer is told so by their
            own mail app, rather than writing to nobody.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            saved ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {saved ? 'Replies on' : 'No reply'}
        </span>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="reply-to" className="label">
          Reply-to address
        </label>
        <input
          id="reply-to"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`hello@${org.slug ?? 'yourco-op'}.org`}
          className="input mt-1 max-w-md"
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          One address, and one somebody reads. Leave it blank for no replies.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !changed}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {busy && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" aria-hidden />}
          {saved && !value.trim() ? 'Turn off replies' : 'Save'}
        </button>
        {done && (
          <span className="inline-flex items-center gap-1 text-sm text-green-700">
            <Check className="h-4 w-4" aria-hidden /> Saved
          </span>
        )}
      </div>
    </section>
  );
}
