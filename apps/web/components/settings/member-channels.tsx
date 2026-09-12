'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Whether any member may open a channel in the Commons (CMN-11).
 *
 * Saves immediately, like the switches beside it: a control that looks
 * flipped but has not been saved leaves an admin believing members can start
 * a conversation when they cannot.
 *
 * No confirmation either way, unlike share tracking. Nothing here exposes
 * anything — every channel is already visible to every member — so the worst
 * case of turning it on is a channel an admin would rather did not exist,
 * which they can rename, re-file or delete. Asking "are you sure?" about that
 * would be ceremony.
 *
 * The state is read from the Commons permissions route rather than the public
 * org route, which answers anybody: how a co-op runs its Commons is not
 * something to publish on the join page.
 */
export function MemberChannels({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const token = useAuthStore((s) => s.token);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.commons
      .permissions(orgId, token)
      .then((permissions) => setEnabled(permissions.memberChannelsEnabled))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read this setting.'));
  }, [orgId, token]);

  async function save(next: boolean) {
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      await api.orgs.update(orgId, { memberChannelsEnabled: next }, token);
      setEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Who can open a channel</h2>
          <p className="mt-1 text-sm text-gray-500">
            {enabled
              ? 'Any member can open a channel in the Commons and invite others to it.'
              : 'Only admins can open a channel. Members can post in the ones that exist.'}
          </p>
        </div>
        {enabled !== null && (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {enabled ? 'Members and admins' : 'Admins only'}
          </span>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {enabled !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => save(!enabled)}
            disabled={saving}
            className={enabled ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
          >
            {saving ? 'Saving...' : enabled ? 'Admins only' : 'Let members open channels'}
          </button>
          <Link
            href={`/admin/${orgSlug}/commons`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Arrange the Commons
          </Link>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Channels are open to the whole co-op either way. Inviting somebody to one sends them a
        message — it does not change who can read it.
      </p>
    </section>
  );
}
