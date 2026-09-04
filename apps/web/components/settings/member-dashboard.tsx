'use client';

import { useState } from 'react';
import { Image as ImageIcon, Target } from 'lucide-react';
import { api, type Org } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * The two things a co-op can put on its members' dashboard (DSH-01).
 *
 * Kept together, and deliberately not split between tabs. The banner is an
 * image and belongs with the logo; the goal is a number and would file under
 * General. But an admin does not think "branding" or "general" — they think
 * "the dashboard my members see", and having the two halves of one screen in
 * two places is how a setting goes unfound.
 *
 * Both are blank by default, and blank is a real answer rather than an
 * unfinished form: no banner means no banner, and no goal means the dashboard
 * states the membership as a fact instead of measuring it against a target
 * nobody set.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function MemberDashboard({ org, onSaved }: { org: Org; onSaved?: () => void }) {
  const token = useAuthStore((s) => s.token);
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState('');

  const [goal, setGoal] = useState(org.memberGoal ? String(org.memberGoal) : '');
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalMessage, setGoalMessage] = useState('');
  const [goalError, setGoalError] = useState('');

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be picked again after an error
    if (!file || !token || !orgId) return;

    // Checked here as well as on the server, so somebody sees the problem
    // before two megabytes cross the network. The server does not trust this.
    if (!TYPES.includes(file.type)) {
      setBannerError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setBannerError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`,
      );
      return;
    }

    setBannerBusy(true);
    setBannerError('');
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that file.'));
        reader.readAsDataURL(file);
      });
      await api.orgs.uploadBanner(orgId, dataUrl, file.type, token);
      onSaved?.();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBannerBusy(false);
    }
  }

  async function handleBannerRemove() {
    if (!token || !orgId) return;
    setBannerBusy(true);
    setBannerError('');
    try {
      await api.orgs.removeBanner(orgId, token);
      onSaved?.();
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not remove the banner');
    } finally {
      setBannerBusy(false);
    }
  }

  async function saveGoal() {
    if (!token || !orgId) return;

    const trimmed = goal.trim();
    // Explicit null, so clearing the box removes the goal rather than leaving
    // the old number quietly in place.
    let value: number | null = null;
    if (trimmed) {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setGoalError('Enter a whole number of members, or leave it blank for no goal.');
        return;
      }
      value = parsed;
    }

    setGoalBusy(true);
    setGoalError('');
    setGoalMessage('');
    try {
      await api.orgs.update(orgId, { memberGoal: value }, token);
      setGoalMessage(
        value === null
          ? 'Cleared. The dashboard will show the membership without a goal.'
          : 'Saved.',
      );
      onSaved?.();
    } catch (err: unknown) {
      setGoalError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setGoalBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-4">
        <div className="flex items-start gap-3">
          <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Dashboard banner</h2>
            <p className="mt-1 text-sm text-gray-500">
              A wide image across the top of your members&apos; dashboard. It works best
              around 1600 × 400. PNG, JPEG or WebP, up to 2 MB.
            </p>
          </div>
        </div>

        {bannerError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{bannerError}</div>
        )}

        {org.bannerUrl && (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={org.bannerUrl}
              alt={`${org.name} banner`}
              className="h-32 w-full object-cover"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`btn-primary text-sm ${bannerBusy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
          >
            {bannerBusy ? 'Uploading...' : org.bannerUrl ? 'Replace banner' : 'Upload banner'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleBannerChange}
              disabled={bannerBusy}
              className="hidden"
            />
          </label>
          {org.bannerUrl && (
            <button
              type="button"
              onClick={handleBannerRemove}
              disabled={bannerBusy}
              className="btn-secondary text-sm"
            >
              Remove
            </button>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Membership goal</h2>
            <p className="mt-1 text-sm text-gray-500">
              How many members you are working toward. Members see progress against it
              on their dashboard. Leave it blank and they just see the number of members.
            </p>
          </div>
        </div>

        {goalError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{goalError}</div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="member-goal" className="sr-only">
            Membership goal
          </label>
          <input
            id="member-goal"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="No goal"
            className="input w-40"
          />
          <button type="button" onClick={saveGoal} disabled={goalBusy} className="btn-primary text-sm">
            {goalBusy ? 'Saving...' : 'Save'}
          </button>
          {goalMessage && <span className="text-sm text-green-700">{goalMessage}</span>}
        </div>
      </section>
    </div>
  );
}
