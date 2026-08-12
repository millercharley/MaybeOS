'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Save } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { TicketPayouts } from '@/components/settings/ticket-payouts';

type SettingsTab = 'general' | 'branding' | 'integrations' | 'billing';

const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'branding', label: 'Branding' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'billing', label: 'Billing' },
];

export default function SettingsPage() {
  const token = useAuthStore((s) => s.token);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const { data: org, loading, refetch } = useApi(
    (tkn, orgId) => api.orgs.get(orgId, tkn),
    [],
  );

  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [orgMission, setOrgMission] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [brandColor, setBrandColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Logo upload (OPS-03c, D-017)
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');

  const LOGO_MAX_BYTES = 2 * 1024 * 1024;
  const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after an error
    if (!file || !token || !currentOrgId) return;

    // Checked here as well as on the server, so the person sees the problem
    // before a 2 MB upload crosses the network. The server does not trust this.
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
      return;
    }

    setLogoBusy(true);
    setLogoError('');
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
      });
      await api.orgs.uploadLogo(currentOrgId, dataUrl, file.type, token);
      refetch();
    } catch (err: unknown) {
      setLogoError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleLogoRemove() {
    if (!token || !currentOrgId) return;
    setLogoBusy(true);
    setLogoError('');
    try {
      await api.orgs.removeLogo(currentOrgId, token);
      refetch();
    } catch (err: unknown) {
      setLogoError(err instanceof Error ? err.message : 'Could not remove the logo');
    } finally {
      setLogoBusy(false);
    }
  }

  // Public joining (MEM-03, D-020)
  const [allowPublicJoin, setAllowPublicJoin] = useState(false);
  const [confirmingOpen, setConfirmingOpen] = useState(false);
  const [joinSaving, setJoinSaving] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (org) {
      setOrgName(org.name || '');
      setOrgSlug(org.slug || '');
      setOrgDescription(org.description || '');
      setOrgMission(org.mission || '');
      setTimezone(org.timezone || 'America/New_York');
      setBrandColor(org.brandColor || '#6366f1');
      setAllowPublicJoin(Boolean(org.allowPublicJoin));
    }
  }, [org]);

  /**
   * Saves immediately rather than waiting for the form's Save button.
   *
   * This switch decides whether strangers can join the co-op, and a control
   * that looks flipped but has not been saved is the worst possible way to
   * get that wrong — an admin would leave the page believing the doors were
   * open, or closed, when they were not.
   */
  async function setPublicJoin(next: boolean) {
    if (!token || !currentOrgId) return;
    setJoinSaving(true);
    setJoinError('');
    try {
      await api.orgs.update(currentOrgId, { allowPublicJoin: next }, token);
      setAllowPublicJoin(next);
      setConfirmingOpen(false);
      refetch();
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setJoinSaving(false);
    }
  }

  async function handleSaveGeneral(e: FormEvent) {
    e.preventDefault();
    if (!token || !currentOrgId) return;
    setSaving(true);
    setSaveMessage('');
    try {
      await api.orgs.update(
        currentOrgId,
        { name: orgName, slug: orgSlug, description: orgDescription, mission: orgMission, timezone },
        token,
      );
      setSaveMessage('Settings saved.');
      refetch();
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBranding(e: FormEvent) {
    e.preventDefault();
    if (!token || !currentOrgId) return;
    setSaving(true);
    setSaveMessage('');
    try {
      await api.orgs.update(currentOrgId, { brandColor } as any, token);
      setSaveMessage('Branding saved.');
      refetch();
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save');
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSaveMessage(''); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-brand-600 text-brand-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {saveMessage && (
        <div className={`rounded-lg p-3 text-sm ${saveMessage.includes('saved') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {saveMessage}
        </div>
      )}

      {activeTab === 'general' && (
        <form onSubmit={handleSaveGeneral} className="card max-w-2xl space-y-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Slug</label>
            <div className="flex items-center">
              <span className="rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                maybeos.org/orgs/
              </span>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="w-full rounded-r-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Mission Statement
            </label>
            <textarea
              value={orgMission}
              onChange={(e) => setOrgMission(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="America/New_York">Eastern Time (US & Canada)</option>
              <option value="America/Chicago">Central Time (US & Canada)</option>
              <option value="America/Denver">Mountain Time (US & Canada)</option>
              <option value="America/Los_Angeles">Pacific Time (US & Canada)</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Berlin">Berlin</option>
              <option value="Asia/Tokyo">Tokyo</option>
            </select>
          </div>

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/*
        Deliberately outside the form above: this saves on change. Bundling it
        into a submit-everything button would let an admin leave the page
        believing the doors were open when they were not.
      */}
      {activeTab === 'general' && org && <TicketPayouts org={org} onSaved={refetch} />}

      {activeTab === 'general' && (
        <section className="card max-w-2xl space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Who can join</h2>
              <p className="mt-1 text-sm text-gray-500">
                {allowPublicJoin
                  ? 'Anyone can join from your public page by choosing a membership tier and paying.'
                  : 'Invitation only. Your public page still shows your tiers, but nobody can join themselves — you invite them.'}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                allowPublicJoin ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {allowPublicJoin ? 'Open to the public' : 'Invitation only'}
            </span>
          </div>

          {joinError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{joinError}</div>
          )}

          {confirmingOpen ? (
            /*
              Enabling is the direction that goes wrong quietly, so it asks
              once. Disabling does not — closing the doors is always safe and
              should never carry friction.
            */
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Open {org?.name || 'this co-op'} to the public?
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Anyone who finds your page and pays becomes a member immediately, with nobody
                approving them. You can switch this off again at any time.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPublicJoin(true)}
                  disabled={joinSaving}
                  className="btn-primary text-sm"
                >
                  {joinSaving ? 'Saving...' : 'Yes, allow anyone to join'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingOpen(false)}
                  disabled={joinSaving}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (allowPublicJoin ? setPublicJoin(false) : setConfirmingOpen(true))}
              disabled={joinSaving}
              className={allowPublicJoin ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
            >
              {joinSaving
                ? 'Saving...'
                : allowPublicJoin
                  ? 'Make invitation only'
                  : 'Allow anyone to join'}
            </button>
          )}
        </section>
      )}

      {activeTab === 'branding' && (
        <section className="card max-w-2xl space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Logo</h2>
            <p className="mt-1 text-sm text-gray-500">
              Shown on your public page and member portal. PNG, JPEG or WebP, up to 2 MB.
            </p>
          </div>

          {logoError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{logoError}</div>
          )}

          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {org?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.logoUrl} alt={`${org.name} logo`} className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xl font-bold text-gray-400">
                  {(org?.name || '?').charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className={`btn-primary text-sm ${logoBusy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
                {logoBusy ? 'Uploading...' : org?.logoUrl ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange}
                  disabled={logoBusy}
                  className="hidden"
                />
              </label>
              {org?.logoUrl && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  disabled={logoBusy}
                  className="btn-secondary text-sm"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'branding' && (
        <form onSubmit={handleSaveBranding} className="card max-w-2xl space-y-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-10 cursor-pointer rounded-lg border border-gray-200"
              />
              <input
                type="text"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#6366f1"
                className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              This color will be used across your community portal
            </p>
          </div>

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'integrations' && (
        <div className="max-w-2xl space-y-4">
          <div className="card flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Stripe</h3>
              <p className="mt-1 text-sm text-gray-500">Payment processing for memberships and events</p>
            </div>
            <span className="text-xs text-gray-400">Coming soon</span>
          </div>
          <div className="card flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Google Calendar</h3>
              <p className="mt-1 text-sm text-gray-500">Sync events with Google Calendar</p>
            </div>
            <span className="text-xs text-gray-400">Coming soon</span>
          </div>
          <div className="card flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Email Provider</h3>
              <p className="mt-1 text-sm text-gray-500">Transactional emails for notifications and invites</p>
            </div>
            <span className="text-xs text-gray-400">Coming soon</span>
          </div>
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="card max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Plan</h2>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Free Plan</p>
                <p className="text-xs text-gray-500">All features included during beta</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Active
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-gray-900">$0</span>
              <span className="text-sm text-gray-500">/month</span>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">Community Plan — $49/month</p>
            <p className="mt-1 text-xs text-gray-500">
              Priority support and advanced features. Available after beta.
            </p>
            <button disabled className="btn-secondary mt-3 text-sm opacity-50">
              Upgrade (coming soon)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
