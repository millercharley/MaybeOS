'use client';

import { useEffect, useState } from 'react';
import { api, SocialStatus } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/** What Facebook's return to `?social=` means, in words for the admin. */
const RETURN_MESSAGES: Record<string, { tone: 'ok' | 'bad'; text: string }> = {
  connected: { tone: 'ok', text: 'Facebook is connected.' },
  pick: { tone: 'ok', text: 'Your login manages more than one Page. Choose the one to share to.' },
  nopages: {
    tone: 'bad',
    text: 'That Facebook login does not manage any Page MaybeOS could post to. Sign in as someone who is an admin of the Page.',
  },
  canceled: { tone: 'bad', text: 'Facebook was not connected.' },
  error: { tone: 'bad', text: 'Facebook could not be connected. Try again.' },
};

/**
 * Sharing public events to the co-op's Facebook Page and Instagram (SOC-01).
 *
 * An admin connects the Page once. There is no approval queue (Charley): hosts
 * share directly, and an admin decides who may, with a default for everyone
 * and a switch per member on the Members page.
 */
export function SocialSharing() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('social');
    if (outcome && RETURN_MESSAGES[outcome]) setNotice(RETURN_MESSAGES[outcome]);
  }, []);

  useEffect(() => {
    if (!token || !orgId) return;
    api.social.status(orgId, token).then(setStatus).catch(() => setStatus(null));
  }, [orgId, token]);

  async function run(work: () => Promise<SocialStatus | void>) {
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      if (next) setStatus(next);
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'That did not work' });
    } finally {
      setBusy(false);
    }
  }

  if (!token || !orgId || !status) return null;

  const connect = () =>
    run(async () => {
      const { url } = await api.social.connect(orgId, token);
      window.location.href = url;
    });

  const disconnect = () => {
    if (!window.confirm('Disconnect Facebook? Hosts will not be able to share until it is connected again.')) return;
    return run(() => api.social.disconnect(orgId, token));
  };

  const { connection } = status;

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Share events to Facebook &amp; Instagram</h2>
          <p className="mt-1 text-sm text-gray-500">
            Hosts can post their public events to your co-op&apos;s Facebook Page and Instagram, credited to
            them, with a link to RSVP.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            status.enabled && connection ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {status.enabled && connection ? 'On' : 'Off'}
        </span>
      </div>

      {notice && (
        <div
          className={`rounded-lg p-3 text-sm ${notice.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      {!status.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This server has no Facebook app set up yet (META_APP_ID, META_APP_SECRET, META_REDIRECT_URI).
        </div>
      )}

      {status.pendingPages && status.pendingPages.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">Choose a Page</p>
          {status.pendingPages.map((page) => (
            <button
              key={page.id}
              type="button"
              disabled={busy}
              onClick={() => run(() => api.social.choosePage(orgId, page.id, token))}
              className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
            >
              <span>{page.name}</span>
              <span className="text-xs text-gray-500">
                {page.igUsername ? `Instagram @${page.igUsername}` : 'No Instagram linked'}
              </span>
            </button>
          ))}
        </div>
      )}

      {connection ? (
        <div className="rounded-lg border border-gray-200 p-3 text-sm">
          <p className="text-gray-900">
            Facebook Page: <strong>{connection.pageName}</strong>
          </p>
          <p className="mt-1 text-gray-700">
            {connection.instagramUsername ? (
              <>
                Instagram: <strong>@{connection.instagramUsername}</strong>
              </>
            ) : (
              <span className="text-amber-800">
                No Instagram business account is linked to this Page, so only Facebook is available. Link one in
                Meta Business Suite, then reconnect.
              </span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={connect} disabled={busy || !status.configured} className="btn-secondary text-sm">
              Reconnect
            </button>
            <button type="button" onClick={disconnect} disabled={busy} className="btn-secondary text-sm">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={connect} disabled={busy || !status.configured} className="btn-primary text-sm">
          Connect Facebook &amp; Instagram
        </button>
      )}

      {connection && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={status.enabled}
              disabled={busy}
              onChange={(e) => run(() => api.social.updateSettings(orgId, { enabled: e.target.checked }, token))}
            />
            <span>
              <span className="font-medium text-gray-900">Let hosts share public events</span>
              <span className="block text-gray-500">Posts go out straight away. There is no approval step.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={status.membersByDefault}
              disabled={busy}
              onChange={(e) =>
                run(() => api.social.updateSettings(orgId, { membersByDefault: e.target.checked }, token))
              }
            />
            <span>
              <span className="font-medium text-gray-900">Every member can share</span>
              <span className="block text-gray-500">
                {status.membersByDefault
                  ? 'Turn someone off on the Members page.'
                  : 'Only members you turn on, on the Members page, can share. Admins and staff always can.'}
              </span>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}
