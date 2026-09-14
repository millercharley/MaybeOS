'use client';

import { useEffect, useState } from 'react';
import { api, Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Door codes, and the co-op's door sheet (DOR-01).
 *
 * The sheet belongs to the co-op's own Google account and is written by an
 * Apps Script that lives inside it. MaybeOS signs requests to that script, so
 * setup is: paste the web app address, generate a secret and paste it into
 * the script, test, then start issuing codes. Emails are a separate switch —
 * Charley's first run was "fill the sheet, email nobody".
 */
export function DoorAccess({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [setup, setSetup] = useState<{ scriptUrl: string | null; secretSet: boolean } | null>(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.door
      .setup(org.id, token)
      .then((s) => {
        setSetup(s);
        setUrl(s.scriptUrl ?? '');
      })
      .catch(() => setSetup(null));
  }, [org.id, token]);

  async function run(label: string, work: () => Promise<string | void>) {
    if (!token) return;
    setBusy(label);
    setError('');
    setDone('');
    try {
      const message = await work();
      if (message) setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const saveUrl = () =>
    run('url', async () => {
      const { scriptUrl } = await api.door.setScript(org.id, url.trim() || null, token!);
      setSetup((s) => (s ? { ...s, scriptUrl } : { scriptUrl, secretSet: false }));
      return scriptUrl ? 'Saved the door script address.' : 'Cleared the door script address.';
    });

  const makeSecret = () => {
    if (
      setup?.secretSet &&
      !window.confirm(
        'Replace the secret? The door sheet stops accepting updates until the new one is pasted into Script Properties.',
      )
    ) {
      return;
    }
    return run('secret', async () => {
      const { secret: fresh } = await api.door.rotateSecret(org.id, token!);
      setSecret(fresh);
      setCopied(false);
      setSetup((s) => (s ? { ...s, secretSet: true } : s));
    });
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the secret and copy it by hand.');
    }
  };

  const test = () =>
    run('test', async () => {
      const { members } = await api.door.test(org.id, token!);
      return `Connected. The door sheet has ${members} ${members === 1 ? 'member' : 'members'}.`;
    });

  const save = (changes: Parameters<typeof api.orgs.update>[1]) =>
    run('save', async () => {
      await api.orgs.update(org.id, changes, token!);
      onSaved();
    });

  const syncNow = () =>
    run('sync', async () => {
      const { issued, synced, emailed } = await api.door.sync(org.id, token!);
      return (
        `Issued ${issued} ${issued === 1 ? 'code' : 'codes'}, sent ${synced} ${synced === 1 ? 'row' : 'rows'} to the sheet` +
        (emailed ? `, emailed ${emailed}` : '') +
        '.'
      );
    });

  const on = Boolean(org.doorAccessEnabled);
  const ready = Boolean(setup?.scriptUrl && setup?.secretSet);

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Door access</h2>
          <p className="mt-1 text-sm text-gray-500">
            {on
              ? 'Members get a five-letter door code, kept in step with your door sheet.'
              : 'Off. Members have no door code and nothing is sent to a door sheet.'}
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

      <div>
        <label className="label" htmlFor="door-script">
          1. Door script web app address
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="door-script"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            className="input min-w-0 flex-1"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={saveUrl}
            disabled={busy !== null || url.trim() === (setup?.scriptUrl ?? '')}
            className="btn-secondary text-sm"
          >
            {busy === 'url' ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          In Apps Script: Deploy → Manage deployments → copy the Web app URL. Changing it sends every
          member to the new sheet on the next sync.
        </p>
      </div>

      <div>
        <p className="label">2. Shared secret</p>
        {secret ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-900">
              Copy this now. It is not shown again. In Apps Script, open Project Settings → Script
              Properties and set <code className="rounded bg-white px-1">MAYBEOS_SECRET</code> to it.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                readOnly
                value={secret}
                onFocus={(e) => e.target.select()}
                className="input min-w-0 flex-1 font-mono text-xs"
                aria-label="New door script secret"
              />
              <button type="button" onClick={copySecret} className="btn-secondary text-sm">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {setup?.secretSet ? 'A secret is set.' : 'No secret yet.'}
          </p>
        )}
        <button
          type="button"
          onClick={makeSecret}
          disabled={busy !== null}
          className="btn-secondary mt-2 text-sm"
        >
          {busy === 'secret' ? 'Generating...' : setup?.secretSet ? 'Replace secret' : 'Generate secret'}
        </button>
      </div>

      <div>
        <p className="label">3. Check the connection</p>
        <button type="button" onClick={test} disabled={busy !== null || !ready} className="btn-secondary text-sm">
          {busy === 'test' ? 'Testing...' : 'Test connection'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => save({ doorAccessEnabled: !on })}
          disabled={busy !== null || (!on && !ready)}
          className={on ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
        >
          {on ? 'Stop issuing codes' : 'Start issuing codes'}
        </button>
        {on && (
          <button type="button" onClick={syncNow} disabled={busy !== null} className="btn-secondary text-sm">
            {busy === 'sync' ? 'Syncing...' : 'Sync now'}
          </button>
        )}
        {!on && !ready && <span className="text-xs text-gray-500">Finish steps 1 and 2 first.</span>}
      </div>

      <p className="text-sm text-gray-500">
        Who can open the door: admins and staff always, members unless their Stripe subscription is
        cancelled, and guests never. Anyone who loses access is marked Revoked in the sheet within 15
        minutes.
      </p>

      {on && (
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">Tell members their code</p>
          <p className="mt-1 text-sm text-gray-500">
            {org.doorCodeEmailsEnabled
              ? 'Members are emailed their code once it is in the sheet.'
              : 'Off. Codes are issued and sent to the sheet, and nobody is emailed. Members can still see theirs on their profile.'}
          </p>
          <button
            type="button"
            onClick={() => save({ doorCodeEmailsEnabled: !org.doorCodeEmailsEnabled })}
            disabled={busy !== null}
            className="btn-secondary mt-3 text-sm"
          >
            {org.doorCodeEmailsEnabled ? 'Stop emailing codes' : 'Start emailing codes'}
          </button>
          {!org.doorCodeEmailsEnabled && (
            <p className="mt-2 text-xs text-gray-500">
              Turning this on emails every member who has not been told yet, including everyone
              already in the sheet.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Anyone who can open the door sheet can read every code in it. Share it with as few people as
        the door needs.
      </p>
    </section>
  );
}
