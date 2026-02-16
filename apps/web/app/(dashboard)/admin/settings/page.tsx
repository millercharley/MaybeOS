'use client';

import { useState } from 'react';
import { Save, Upload, CheckCircle, ExternalLink } from 'lucide-react';

type SettingsTab = 'general' | 'branding' | 'integrations' | 'billing';

const tabs: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'branding', label: 'Branding' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'billing', label: 'Billing' },
];

interface Integration {
  id: string;
  name: string;
  description: string;
  connected: boolean;
}

const integrations: Integration[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing for memberships and events',
    connected: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Sync events with Google Calendar',
    connected: false,
  },
  {
    id: 'email',
    name: 'Email Provider',
    description: 'Transactional emails for notifications and invites',
    connected: false,
  },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const [orgName, setOrgName] = useState('Community Cooperative');
  const [orgSlug, setOrgSlug] = useState('community-coop');
  const [orgDescription, setOrgDescription] = useState(
    'A member-owned cooperative fostering community connection and shared resources.',
  );
  const [orgMission, setOrgMission] = useState(
    'To build a thriving, inclusive community where every member has a voice and a stake in our collective future.',
  );
  const [timezone, setTimezone] = useState('America/New_York');

  const [brandColor, setBrandColor] = useState('#6366f1');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
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

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="card max-w-2xl space-y-6">
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
                maybeos.app/
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
            <button className="btn-primary inline-flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Branding Tab */}
      {activeTab === 'branding' && (
        <div className="card max-w-2xl space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Organization Logo
            </label>
            <div className="flex items-center gap-6">
              <div className="flex h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
                <div className="text-center">
                  <Upload className="mx-auto h-6 w-6 text-gray-400" />
                  <span className="mt-1 block text-xs text-gray-400">Upload</span>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                <p>Recommended: 256x256px or larger</p>
                <p>Formats: PNG, JPG, SVG</p>
                <button className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700">
                  Upload logo
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Brand Color</label>
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-lg border border-gray-200"
                style={{ backgroundColor: brandColor }}
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
            <button className="btn-primary inline-flex items-center gap-2">
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="max-w-2xl space-y-4">
          {integrations.map((integration) => (
            <div
              key={integration.id}
              className="card flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{integration.name}</h3>
                  {integration.connected && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500">{integration.description}</p>
              </div>
              <div>
                {integration.connected ? (
                  <button className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Manage
                  </button>
                ) : (
                  <button className="btn-primary text-sm">Connect</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <div className="card max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Billing & Subscription</h2>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Community Plan</p>
                <p className="text-xs text-gray-500">Up to 500 members, all features included</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Active
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-gray-900">$49</span>
              <span className="text-sm text-gray-500">/month</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Next billing date: March 1, 2026</p>
          </div>

          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-medium text-gray-900">Payment Method</h3>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-12 items-center justify-center rounded bg-gray-100 text-xs font-bold text-gray-600">
                  VISA
                </div>
                <div>
                  <p className="text-sm text-gray-900">**** **** **** 4242</p>
                  <p className="text-xs text-gray-500">Expires 12/2027</p>
                </div>
              </div>
              <button className="text-sm font-medium text-brand-600 hover:text-brand-700">
                Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
