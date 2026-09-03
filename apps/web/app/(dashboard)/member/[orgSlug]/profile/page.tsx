'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Save, Mail, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { DemographicProfile } from '@/components/member/demographic-profile';
import { ChangePassword } from '@/components/member/change-password';
import { useParams } from 'next/navigation';
import { BuddySettings } from '@/components/belonging/buddy-settings';
import { ForumMembership } from '@/components/member/forum-membership';

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
  // Per-membership, not per-user: what somebody writes for one co-op is not
  // consent to publish it in another (D-020, IMP-17). The directory could show
  // a biography long before anything could write one.
  const [bio, setBio] = useState('');
  // Kept as a list of rows rather than one textarea of newline-separated URLs:
  // a member adding a second link should not have to guess the separator, and
  // a bad row should be able to say which one it is.
  const [links, setLinks] = useState<string[]>([]);
  const [headline, setHeadline] = useState('');
  const [location, setLocation] = useState('');
  // Nullable on purpose — null means nobody has ever asked this member, which
  // is different from their having declined (MEM-06).
  const [emailOptIn, setEmailOptIn] = useState<boolean | null>(null);
  const [linkError, setLinkError] = useState('');
  const orgId = useAuthStore((s) => s.currentOrgId);
  const orgSlug = useParams<{ orgSlug: string }>().orgSlug;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (profile) setName(profile.name || '');
  }, [profile]);

  useEffect(() => {
    if (!token || !orgId) return;
    api.members
      .get(orgId, profile?.id ?? '', token)
      .then((me) => {
        setBio(me.bio ?? '');
        setLinks(me.links ?? []);
        setHeadline(me.headline ?? '');
        setLocation(me.location ?? '');
        setEmailOptIn(me.emailOptIn ?? null);
      })
      .catch(() => {});
  }, [token, orgId, profile?.id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    // Checked here as well as at the API, so a mistyped address says so beside
    // the field instead of coming back as a validation error about an array.
    const bad = links.find((l) => l.trim() && !/^https?:\/\/\S+$/i.test(l.trim()));
    if (bad) {
      setLinkError(`"${bad}" needs to start with http:// or https://`);
      return;
    }
    setLinkError('');

    setSaving(true);
    setMessage('');
    try {
      await api.auth_profile.update({ name }, token);
      // The name lives on the account and the biography on the membership, so
      // saving this form is two writes rather than one.
      if (orgId) {
        // Blank rows are the normal state of a form somebody is still filling
        // in, so they are dropped rather than rejected.
        await api.members.updateMine(
          orgId,
          {
            bio,
            links: links.filter((l) => l.trim()),
            headline,
            location,
            // Only sent once the member has actually answered. Sending false
            // for "never asked" would record a refusal they never made.
            ...(emailOptIn !== null && { emailOptIn }),
          },
          token,
        );
      }
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
    <div className="space-y-6">
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
            Headline
          </label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={160}
            placeholder="Ask me anything about sourdough"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            One line under your name in the directory.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={120}
            placeholder="Butchertown, KY"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            About you
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Potter, gardener, reluctant treasurer."
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {/* Said plainly, because it is not obvious and it matters: this is
                per co-op, and other members can read it. */}
            Other members see this when they open your card in the directory. It belongs to this
            co-op only — joining another won&apos;t carry it across.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3">
          <label className="flex items-start gap-2.5 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={emailOptIn === true}
              onChange={(e) => setEmailOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--border)] text-brand-600 focus:ring-brand-500"
            />
            <span>
              Email me about what this co-op is up to
              <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
                {/* Members brought across from another platform arrive with
                    this already set. Being able to switch it off is the other
                    half of importing it. */}
                Separate from the emails about your own membership, which are sent either way.
              </span>
            </span>
          </label>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            Links
          </label>
          <div className="space-y-2">
            {links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <input
                  value={link}
                  onChange={(e) => {
                    const next = [...links];
                    next[index] = e.target.value;
                    setLinks(next);
                  }}
                  placeholder="https://www.instagram.com/yourname/"
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  aria-label={`Link ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setLinks(links.filter((_, i) => i !== index))}
                  className="shrink-0 px-2 text-sm text-[var(--text-tertiary)] hover:text-red-600"
                  aria-label={`Remove link ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {links.length < 25 && (
            <button
              type="button"
              onClick={() => setLinks([...links, ''])}
              className="mt-2 text-sm font-medium text-brand-600 hover:underline"
            >
              + Add a link
            </button>
          )}

          {linkError && (
            <p className="mt-1 text-xs text-red-600" role="alert">{linkError}</p>
          )}

          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Your website, shop, or wherever else you want members to find you. Shown on your card in
            this co-op&apos;s directory, and like your introduction it doesn&apos;t follow you to
            another co-op.
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

      <ChangePassword />

      <DemographicProfile />

      {/* Renders nothing unless this co-op runs the Buddy System and this
          member has some history with it (BEL). The Off the Hook email links
          straight to `#buddy`. */}
      {orgId && orgSlug && <BuddySettings orgId={orgId} orgSlug={orgSlug} />}

      {/* Renders nothing on a deployment with no forum (FRM-01). */}
      <ForumMembership />

      {profile.orgs && profile.orgs.length > 0 && (
        <section className="card">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Membership</h2>
          <ul className="mt-3 space-y-2">
            {profile.orgs.map((membership) => (
              <li
                key={membership.orgId}
                className="flex flex-wrap items-center justify-between text-sm gap-3"
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
