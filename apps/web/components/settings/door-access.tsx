'use client';

import { useEffect, useState } from 'react';
import { api, Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Door codes, and the sheet the door application reads (DOR-01).
 *
 * Three switches rather than one, because a co-op turns them on at different
 * moments and Charley's first run was explicitly "fill the sheet, email
 * nobody": name the sheet, start issuing codes, and — separately, when the
 * sheet looks right — start telling members what theirs is.
 *
 * Saves immediately, like the switches beside it. A control that looks
 * flipped but has not been saved would leave an organiser believing the door
 * works.
 */
export function DoorAccess({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [sheet, setSheet] = useState(org.doorSheetId ?? '');
  const [setup, setSetup] = useState<{ googleConfigured: boolean; shareSheetWith: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.door
      .setup(org.id, token)
      .then(setSetup)
      .catch(() => setSetup(null));
  }, [org.id, token]);

  async function save(changes: Parameters<typeof api.orgs.update>[1]) {
    if (!token) return;
    setSaving(true);
    setError('');
    setDone('');
    try {
      await api.orgs.update(org.id, changes, token);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    if (!token) return;
    setSyncing(true);
    setError('');
    setDone('');
    try {
      const { issued, synced, emailed } = await api.door.sync(org.id, token);
      setDone(
        `Issued ${issued} ${issued === 1 ? 'code' : 'codes'}, wrote ${synced} to the sheet` +
          (emailed ? `, emailed ${emailed}` : '') +
          '.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync just now');
    } finally {
      setSyncing(false);
    }
  }

  const on = Boolean(org.doorAccessEnabled);

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Door access</h2>
          <p className="mt-1 text-sm text-gray-500">
            {on
              ? 'Every member gets a five-letter code, mirrored to your Google Sheet for the door to read.'
              : 'Off. Members have no door code and nothing is written to a sheet.'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            on ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {on ? 'Issuing codes' : 'Off'}
        </span>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{done}</div>}

      {/* Nothing can work without the server credential, so this is said
          first rather than left for a failed sync to explain. */}
      {setup && !setup.googleConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This server has no Google credentials yet, so nothing can be written to a sheet.
          Ask whoever runs MaybeOS to set <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>.
        </div>
      )}

      {setup?.shareSheetWith && (
        <p className="text-sm text-gray-500">
          Share your sheet — as an <strong>Editor</strong> — with{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{setup.shareSheetWith}</code>
        </p>
      )}

      <div>
        <label className="label" htmlFor="door-sheet">Google Sheet</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="door-sheet"
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
            placeholder="Paste the sheet's address"
            className="input min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => save({ doorSheetId: sheet.trim() || null })}
            disabled={saving}
            className="btn-secondary text-sm"
          >
            {saving ? 'Saving...' : 'Save sheet'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Paste the whole address from your browser — MaybeOS keeps the id out of it. It needs
          columns named Email, Door Code and Full Name; an empty sheet gets them written for it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => save({ doorAccessEnabled: !on })}
          disabled={saving || (!on && !org.doorSheetId)}
          className={on ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
        >
          {on ? 'Stop issuing codes' : 'Start issuing codes'}
        </button>
        {on && (
          <button type="button" onClick={syncNow} disabled={syncing} className="btn-secondary text-sm">
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
        )}
        {!on && !org.doorSheetId && (
          <span className="text-xs text-gray-500">Name a sheet first.</span>
        )}
      </div>

      {on && (
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">Tell members their code</p>
          <p className="mt-1 text-sm text-gray-500">
            {org.doorCodeEmailsEnabled
              ? 'Members are emailed their code once it is in the sheet.'
              : 'Off. Codes are issued and written to the sheet, and nobody is emailed. Members can still see theirs on their profile.'}
          </p>
          <button
            type="button"
            onClick={() => save({ doorCodeEmailsEnabled: !org.doorCodeEmailsEnabled })}
            disabled={saving}
            className="btn-secondary mt-3 text-sm"
          >
            {org.doorCodeEmailsEnabled ? 'Stop emailing codes' : 'Start emailing codes'}
          </button>
          {!org.doorCodeEmailsEnabled && (
            <p className="mt-2 text-xs text-gray-500">
              Turning this on emails every member who has not been told yet — including everyone
              already in the sheet.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Anyone who can open that sheet can read every door code in it. Keep it shared with as few
        people as the door needs.
      </p>
    </section>
  );
}
