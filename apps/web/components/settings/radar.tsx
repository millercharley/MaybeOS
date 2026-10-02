'use client';

import { FormEvent, useEffect, useState } from 'react';
import { InterestTag, RadarSettings, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "9am", "1pm" — the way an admin would say it, not 09:00. */
function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * Radar (RDR-01): the weekly digest that tells a member about gatherings
 * matching what they are interested in.
 *
 * Three things live here, in the order an admin meets them: whether it is on,
 * when it goes out, and the list of interests that members pick from and
 * hosts tag gatherings with. The list is the part that decides whether any of
 * it works, which is why it is on this screen rather than buried somewhere
 * under events.
 *
 * What is deliberately absent: any view of what an individual member is
 * interested in. An admin sees how many members have said something and how
 * many get the email. Who likes what is between the member and the matching.
 */
export function Radar() {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [settings, setSettings] = useState<RadarSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [newTag, setNewTag] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!token || !orgId) return;
    api.radar.settings(orgId, token).then(setSettings).catch(() => setSettings(null));
  }, [orgId, token]);

  async function run(work: () => Promise<RadarSettings | void>) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      if (next) setSettings(next);
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : 'That did not work' });
    } finally {
      setBusy(false);
    }
  }

  /** Re-read rather than patch locally: tag edits change more than they return. */
  const refresh = async () => {
    if (!token || !orgId) return;
    setSettings(await api.radar.settings(orgId, token));
  };

  if (!token || !orgId || !settings) return null;

  const addTag = (e: FormEvent) => {
    e.preventDefault();
    const name = newTag.trim();
    if (!name) return;
    run(async () => {
      await api.radar.createTag(orgId, { name }, token);
      setNewTag('');
      await refresh();
    });
  };

  const saveName = (tag: InterestTag, name: string) =>
    run(async () => {
      if (name.trim() && name.trim() !== tag.name) {
        await api.radar.updateTag(orgId, tag.id, { name: name.trim() }, token);
      }
      setEditing(null);
      await refresh();
    });

  const toggleTag = (tag: InterestTag) =>
    run(async () => {
      await api.radar.updateTag(orgId, tag.id, { isActive: !tag.isActive }, token);
      await refresh();
    });

  const active = settings.tags.filter((tag) => tag.isActive);
  const retired = settings.tags.filter((tag) => !tag.isActive);

  return (
    <section className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Radar</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-500">
            Once a week, MaybeOS emails each member the gatherings coming up that match what
            they&rsquo;re interested in. It learns from what they tell you and from what they
            RSVP to, and it only looks at events open to members.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            settings.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {settings.enabled ? 'On' : 'Off'}
        </span>
      </div>

      {notice && (
        <div
          className={`rounded-lg p-3 text-sm ${
            notice.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/*
        The upgrade path, stated once and without nagging. A co-op on Free is
        not doing anything wrong, and the sentence says what Radar would do
        rather than what they are missing.
      */}
      {!settings.available ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Radar is part of Plus and Unlimited. Upgrade in Billing and MaybeOS will start matching
          your gatherings to what your members are interested in.
        </div>
      ) : (
        <>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) =>
                run(() => api.radar.updateSettings(orgId, { enabled: e.target.checked }, token))
              }
              className="mt-1"
            />
            <span className="text-sm text-gray-700">
              Send the weekly radar email
              <span className="block text-gray-500">
                Every member can turn it off for themselves, and every email says how.
              </span>
            </span>
          </label>

          {settings.enabled && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-gray-700">
                <span className="block font-medium">Goes out on</span>
                <select
                  value={settings.digestDay}
                  disabled={busy}
                  onChange={(e) =>
                    run(() =>
                      api.radar.updateSettings(orgId, { digestDay: Number(e.target.value) }, token),
                    )
                  }
                  className="mt-1 rounded-lg border border-gray-300 px-3 py-2"
                >
                  {DAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-gray-700">
                <span className="block font-medium">At</span>
                <select
                  value={settings.digestHour}
                  disabled={busy}
                  onChange={(e) =>
                    run(() =>
                      api.radar.updateSettings(orgId, { digestHour: Number(e.target.value) }, token),
                    )
                  }
                  className="mt-1 rounded-lg border border-gray-300 px-3 py-2"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </select>
              </label>

              <p className="text-sm text-gray-500">
                Your community&rsquo;s own time. {settings.subscribed} member
                {settings.subscribed === 1 ? '' : 's'} would get it, and {settings.withInterests}{' '}
                {settings.withInterests === 1 ? 'has' : 'have'} told you what they&rsquo;re
                interested in.
              </p>
            </div>
          )}
        </>
      )}

      <div className="border-t border-gray-100 pt-5">
        <h3 className="text-sm font-semibold text-gray-900">Interests</h3>
        <p className="mt-1 max-w-prose text-sm text-gray-500">
          The words your members pick from, and the same ones hosts tag a gathering with. Rename
          anything that isn&rsquo;t how your community talks — renaming one also renames it on
          every event already tagged with it.
        </p>

        <ul className="mt-4 space-y-2">
          {active.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3">
              <span aria-hidden className="w-6 text-center">
                {tag.emoji ?? '•'}
              </span>
              {editing?.id === tag.id ? (
                <input
                  autoFocus
                  value={editing.name}
                  disabled={busy}
                  onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                  onBlur={() => saveName(tag, editing.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName(tag, editing.name);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ id: tag.id, name: tag.name })}
                  className="flex-1 text-left text-sm text-gray-900 hover:underline"
                >
                  {tag.name}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleTag(tag)}
                disabled={busy}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Retire
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={addTag} className="mt-4 flex flex-wrap gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add an interest"
            maxLength={40}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !newTag.trim()} className="btn-secondary">
            Add
          </button>
        </form>

        {retired.length > 0 && (
          <div className="mt-5">
            {/*
              Retired rather than deleted, and still listed: these are the
              words on gatherings the co-op has already run, and a member may
              still have an answer recorded against them.
            */}
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Retired
            </h4>
            <ul className="mt-2 space-y-2">
              {retired.map((tag) => (
                <li key={tag.id} className="flex items-center gap-3 text-sm text-gray-500">
                  <span aria-hidden className="w-6 text-center">
                    {tag.emoji ?? '•'}
                  </span>
                  <span className="flex-1">{tag.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    disabled={busy}
                    className="hover:text-gray-900"
                  >
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
