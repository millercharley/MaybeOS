'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Save, Mail, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

/**
 * "My Profile" (MEM-01).
 *
 * Linked from the member dashboard since it was built; the page never existed,
 * so the link 404'd.
 *
 * Scope is deliberately what a member owns about themselves. Email is shown
 * but not editable — changing it is an identity change that needs the new
 * address verified, and there is no such flow yet. Role is shown and not
 * editable because it is the co-op's decision, not the member's.
 */
export default function MyProfilePage() {
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);

  const { data: profile, loading, error, refetch } = useApi(
    () => api.auth.profile(token as string),
    [],
  );

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (profile) setName(profile.name || '');
  }, [profile]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMessage('');
    try {
      await api.auth_profile.update({ name }, token);
      // Refresh the store too: otherwise the old name sits in the corner of
      // every other page until the next sign-in.
      await loadProfile();
      setMessage('Saved.');
      refetch();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Couldn&apos;t load your profile{error ? `: ${error}` : ''}
      </div>
    );
  }

  const initial = (profile.name || profile.email || '?').charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">My Profile</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          How you appear to the rest of your co-op.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message === 'Saved.' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="card space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-brand-700">{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)]">
              {profile.name || 'No name set'}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              <Mail className="h-3.5 w-3.5" />
              {profile.email}
              {profile.emailVerified && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> verified
                </span>
              )}
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            Display name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Your name"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Shown on your posts, comments and the member directory.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            Email
          </label>
          <input
            type="email"
            value={profile.email}
            disabled
            className="w-full cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--text-secondary)]"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            You sign in with this. Ask an organiser if it needs changing.
          </p>
        </div>

        <div className="flex justify-end border-t border-[var(--border)] pt-4">
          <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {profile.orgs && profile.orgs.length > 0 && (
        <section className="card">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Membership</h2>
          <ul className="mt-3 space-y-2">
            {profile.orgs.map((membership) => (
              <li
                key={membership.orgId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--text-primary)]">
                  {membership.org?.name || membership.orgId}
                </span>
                <span className="rounded-full bg-[var(--surface-sunken)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                  {membership.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            Your role is set by your co-op&apos;s organisers.
          </p>
        </section>
      )}
    </div>
  );
}
