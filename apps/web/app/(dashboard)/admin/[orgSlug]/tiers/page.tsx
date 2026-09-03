'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, CheckCircle2, Users, EyeOff, Eye } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { api, AdminTier, TierInput, ServicePeriod, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

const money = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

/** Cents <-> dollar string, kept as text so a half-typed "12." survives. */
const toDollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, '');
const toCents = (s: string) => Math.round(parseFloat(s || '0') * 100);

type Draft = {
  name: string;
  description: string;
  price: string;
  isPayWhatYouCan: boolean;
  minPrice: string;
  benefits: string;
  /** Service asked of this tier, in hours. Blank means none (SRV-01). */
  serviceHours: string;
  servicePeriod: string;
};

const emptyDraft: Draft = {
  name: '',
  description: '',
  price: '',
  isPayWhatYouCan: false,
  minPrice: '',
  benefits: '',
  serviceHours: '',
  servicePeriod: 'MONTH',
};

const draftFrom = (t: AdminTier): Draft => ({
  name: t.name,
  description: t.description ?? '',
  price: toDollars(t.priceMonthly),
  isPayWhatYouCan: t.isPayWhatYouCan,
  minPrice: t.minPrice ? toDollars(t.minPrice) : '',
  benefits: (t.benefits ?? []).join('\n'),
  // Hours in the form, minutes on the wire: a co-op says "four hours a
  // month", and asking an organiser to type 240 invites a slip of a zero.
  serviceHours: t.serviceMinutes ? String(t.serviceMinutes / 60) : '',
  servicePeriod: t.servicePeriod ?? 'MONTH',
});

const toInput = (d: Draft): TierInput => ({
  name: d.name.trim(),
  description: d.description.trim() || undefined,
  priceMonthly: d.isPayWhatYouCan ? toCents(d.minPrice) : toCents(d.price),
  isPayWhatYouCan: d.isPayWhatYouCan,
  minPrice: d.isPayWhatYouCan ? toCents(d.minPrice) : undefined,
  benefits: d.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
  // Explicit null rather than omitted, so clearing the field removes the
  // expectation instead of silently leaving the old one in place.
  serviceMinutes: d.serviceHours.trim()
    ? Math.round(parseFloat(d.serviceHours) * 60)
    : null,
  servicePeriod: d.serviceHours.trim() ? (d.servicePeriod as ServicePeriod) : null,
});

export default function AdminTiersPage() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgId = currentOrgId ?? user?.orgs?.[0]?.orgId;

  const [tiers, setTiers] = useState<AdminTier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  // Checked by default: existing members keep the price they agreed to.
  // Unchecking raises them at their next renewal. See D-016.
  const [grandfather, setGrandfather] = useState(true);

  const load = useCallback(async () => {
    if (!token || !orgId) return;
    try {
      setTiers(await api.members.listTiersForAdmin(orgId, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load tiers.');
    }
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const editing = tiers?.find((t) => t.id === editingId) ?? null;

  // The grandfathering question is only meaningful when a price change would
  // actually hit somebody. No subscribers, no decision — don't ask.
  const priceChanged =
    !!editing && !editing.isPayWhatYouCan && toCents(draft.price) !== editing.priceMonthly;
  const affectsMembers = priceChanged && editing.activeSubscribers > 0;

  function startCreate() {
    setDraft(emptyDraft);
    setEditingId(null);
    setCreating(true);
    setNotice(null);
    setError(null);
  }

  function startEdit(t: AdminTier) {
    setDraft(draftFrom(t));
    setEditingId(t.id);
    setCreating(false);
    setGrandfather(true);
    setNotice(null);
    setError(null);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save() {
    if (!token || !orgId) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (creating) {
        await api.members.createTier(orgId, toInput(draft), token);
        setNotice(`"${draft.name}" created.`);
      } else if (editingId) {
        const res = await api.members.updateTier(
          orgId,
          editingId,
          { ...toInput(draft), applyToExistingMembers: affectsMembers ? !grandfather : undefined },
          token,
        );
        // Say what happened to people's money, not just "saved".
        if (res.repriced && res.migratedSubscribers > 0) {
          setNotice(
            `Price updated. ${res.migratedSubscribers} member${res.migratedSubscribers === 1 ? '' : 's'} move to the new price at their next renewal.`,
          );
        } else if (res.repriced && res.grandfathered) {
          setNotice('Price updated for new members. Existing members keep their current price.');
        } else {
          setNotice(`"${draft.name}" updated.`);
        }
      }
      cancel();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the tier.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(t: AdminTier) {
    if (!token || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      await api.members.updateTier(orgId, t.id, { isActive: !t.isActive }, token);
      setNotice(
        t.isActive
          ? `"${t.name}" hidden. Existing members keep their subscription.`
          : `"${t.name}" is visible again.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the tier.');
    } finally {
      setBusy(false);
    }
  }

  if (!orgId) {
    return <p className="text-[var(--text-secondary)]">No organization selected.</p>;
  }

  const showForm = creating || !!editingId;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageHeader
            title="Membership tiers"
            description="What members can pay, and what they get for it."
          />
        </div>
        {!showForm && (
          <button onClick={startCreate} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} aria-hidden="true" />
            New tier
          </button>
        )}
      </div>

      {notice && (
        <div className="card mt-6 flex gap-3 border-[var(--success)]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]" />
          <p className="text-sm">{notice}</p>
        </div>
      )}
      {error && (
        <div className="card mt-6 flex gap-3 border-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger)]" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {showForm && (
        <div className="card mt-6">
          <h2 className="font-display text-lg">{creating ? 'New tier' : `Edit ${editing?.name}`}</h2>

          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                className="input mt-1 w-full"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Community"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Description</span>
              <input
                className="input mt-1 w-full"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Basic membership with access to events"
              />
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.isPayWhatYouCan}
                onChange={(e) => setDraft({ ...draft, isPayWhatYouCan: e.target.checked })}
              />
              <span className="text-sm font-medium">Pay what you can</span>
            </label>

            {draft.isPayWhatYouCan ? (
              <label className="block">
                <span className="text-sm font-medium">Minimum per month</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)]">$</span>
                  <input
                    type="number" min="0.50" step="0.01"
                    className="input w-32"
                    value={draft.minPrice}
                    onChange={(e) => setDraft({ ...draft, minPrice: e.target.value })}
                    placeholder="5.00"
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Members choose their own amount at or above this. Stripe won&apos;t accept
                  anything under $0.50.
                </p>
              </label>
            ) : (
              <label className="block">
                <span className="text-sm font-medium">Price per month</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)]">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    className="input w-32"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    placeholder="15.00"
                  />
                </div>
              </label>
            )}

            <label className="block">
              <span className="text-sm font-medium">Benefits</span>
              <textarea
                className="input mt-1 w-full"
                rows={4}
                value={draft.benefits}
                onChange={(e) => setDraft({ ...draft, benefits: e.target.value })}
                placeholder={'One per line\nAccess to events\nCommunity forum'}
              />
            </label>

            {/* Service asked of this tier (SRV-01). Blank is the default and
                true of every tier that exists today — most tiers ask for
                money and nothing else. */}
            <fieldset className="block">
              <legend className="text-sm font-medium">Service expected</legend>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="input w-24"
                  value={draft.serviceHours}
                  onChange={(e) => setDraft({ ...draft, serviceHours: e.target.value })}
                  placeholder="4"
                />
                <span className="text-sm text-[var(--text-secondary)]">hours per</span>
                <select
                  /* `.input` is `w-full`, which pushed the select onto its own
                     line and made "4 hours per" read as an unfinished
                     sentence. */
                  className="input w-32"
                  value={draft.servicePeriod}
                  disabled={!draft.serviceHours.trim()}
                  onChange={(e) => setDraft({ ...draft, servicePeriod: e.target.value })}
                >
                  <option value="WEEK">week</option>
                  <option value="MONTH">month</option>
                  <option value="YEAR">year</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Leave blank to ask for nothing. Members see how they stand under My
                Service, and you see the co-op under Serving. Somebody joining part way
                through a period is asked for a share of it, not the whole thing.
              </p>
            </fieldset>

            {/* Only shown when a price change would actually hit somebody. */}
            {affectsMembers && (
              <div className="card border-[var(--warning)] bg-[var(--surface-sunken)]">
                <div className="flex items-start gap-3">
                  <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--warning)]" />
                  <div>
                    <p className="font-semibold">
                      {editing!.activeSubscribers} member
                      {editing!.activeSubscribers === 1 ? ' is' : 's are'} paying{' '}
                      {money(editing!.priceMonthly)} on this tier
                    </p>
                    <label className="mt-3 flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={grandfather}
                        onChange={(e) => setGrandfather(e.target.checked)}
                      />
                      <span className="text-sm">
                        Keep them at {money(editing!.priceMonthly)}. Only new members pay{' '}
                        {money(toCents(draft.price))}.
                      </span>
                    </label>
                    {!grandfather && (
                      <p className="mt-2 text-sm text-[var(--danger)]">
                        All {editing!.activeSubscribers} will move to{' '}
                        {money(toCents(draft.price))} at their next renewal. Nobody is charged
                        today.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={save} disabled={busy || !draft.name.trim()} className="btn-primary inline-flex items-center gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {creating ? 'Create tier' : 'Save changes'}
              </button>
              <button onClick={cancel} disabled={busy} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-3">
        {tiers === null && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        )}

        {tiers?.length === 0 && (
          <p className="text-[var(--text-secondary)]">
            No tiers yet. Create one so members have something to join.
          </p>
        )}

        {tiers?.map((t) => (
          <div key={t.id} className={`card ${t.isActive ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  {t.isPayWhatYouCan && <span className="badge-info">Pay what you can</span>}
                  {!t.isActive && <span className="badge-neutral">Hidden</span>}
                  {!t.stripePriceIdMonthly && !t.isPayWhatYouCan && (
                    <span className="badge-warning">Not purchasable</span>
                  )}
                </div>
                {t.description && (
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{t.description}</p>
                )}
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  {t.activeSubscribers} active member{t.activeSubscribers === 1 ? '' : 's'}
                </p>
              </div>

              <div className="flex items-center gap-3 whitespace-nowrap">
                <span className="data text-lg font-semibold">
                  {t.isPayWhatYouCan ? `${money(t.minPrice ?? 0)}+` : money(t.priceMonthly)}
                </span>
                <button onClick={() => startEdit(t)} disabled={busy} className="btn-secondary">
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(t)}
                  disabled={busy}
                  className="btn-ghost inline-flex items-center gap-1"
                  title={t.isActive ? 'Hide from the join page' : 'Show on the join page'}
                >
                  {t.isActive ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-[var(--text-tertiary)]">
        Hiding a tier removes it from the join page. Members already on it keep their
        subscription and keep being billed.
      </p>
    </div>
  );
}
