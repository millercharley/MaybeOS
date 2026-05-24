'use client';

import { useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export function OrgSetup() {
  const token = useAuthStore((s) => s.token);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [mission, setMission] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setLoading(true);

    try {
      const org = await api.orgs.create(
        { name, slug, description: description || undefined, mission: mission || undefined },
        token,
      );
      setCurrentOrg(org.id);
      await loadProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create organization';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600">
            <span className="text-2xl font-bold text-white">M</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to MaybeOS</h1>
          <p className="mt-2 text-gray-600">
            Create your organization to get started. This will be your co-op's home base.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-gray-700">
                Organization Name *
              </label>
              <input
                id="org-name"
                type="text"
                className="input w-full"
                placeholder="e.g. MaybeItsFate Co-op"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="org-slug" className="mb-1 block text-sm font-medium text-gray-700">
                URL Slug *
              </label>
              <div className="flex items-center">
                <span className="mr-2 text-sm text-gray-400">maybeos.org/orgs/</span>
                <input
                  id="org-slug"
                  type="text"
                  className="input flex-1"
                  placeholder="maybeitsfate"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                  pattern="[a-z0-9-]+"
                  title="Lowercase letters, numbers, and hyphens only"
                />
              </div>
            </div>

            <div>
              <label htmlFor="org-description" className="mb-1 block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="org-description"
                className="input w-full"
                rows={2}
                placeholder="A short description of your organization"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="org-mission" className="mb-1 block text-sm font-medium text-gray-700">
                Mission Statement
              </label>
              <textarea
                id="org-mission"
                className="input w-full"
                rows={2}
                placeholder="What drives your community?"
                value={mission}
                onChange={(e) => setMission(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading || !name || !slug}>
              {loading ? 'Creating...' : 'Create Organization'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
