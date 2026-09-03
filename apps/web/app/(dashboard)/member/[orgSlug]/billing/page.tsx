'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, ExternalLink, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { usePublicApi } from '@/hooks/use-api';
import { api, MembershipTier, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';

/** Cents → "$12" or "$12.50", never "$12.00". */
function money(cents: number): string {
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}

const STATUS_COPY: Record<string, { label: string; tone: string; detail: string }> = {
  ACTIVE: { label: 'Active', tone: 'badge-success', detail: 'Your dues are paid and up to date.' },
  TRIALING: { label: 'Trial', tone: 'badge-info', detail: "You're in a trial period." },
  PAST_DUE: {
    label: 'Past due',
    tone: 'badge-warning',
    detail: 'The last payment did not go through. Update your payment method to stay active.',
  },
  CANCELED: { label: 'Canceled', tone: 'badge-neutral', detail: 'Your membership dues have ended.' },
  COMP: { label: 'Complimentary', tone: 'badge-success', detail: 'Your dues are waived.' },
  NONE: { label: 'Not set up', tone: 'badge-neutral', detail: 'Choose a tier below to start paying dues.' },
};

export default function MemberBillingPage() {
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);

  const membership = user?.orgs?.find((o) => o.orgId === currentOrgId) ?? user?.orgs?.[0];
  const orgId = membership?.orgId;

  const { data: tiers, loading: tiersLoading } = usePublicApi(
    () => (orgId ? api.orgs.listTiers(orgId) : Promise.resolve([])),
    [orgId],
  );

  // Amount entered for a pay-what-you-can tier, keyed by tier id, held as the
  // raw string so a half-typed "1." doesn't get clobbered mid-keystroke.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pendingTierId, setPendingTierId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const justReturned = searchParams.get('checkout');

  async function startCheckout(tier: MembershipTier) {
    if (!token || !orgId) return;
    setError(null);
    setPendingTierId(tier.id);

    try {
      const origin = window.location.origin;
      const { url } = await api.stripe.createCheckout(
        orgId,
        {
          tierId: tier.id,
          successUrl: `${origin}/member/billing?checkout=success`,
          cancelUrl: `${origin}/member/billing?checkout=canceled`,
          // Only send an amount for PWYC tiers — the API rejects one on a
          // fixed-price tier rather than silently ignoring it.
          ...(tier.isPayWhatYouCan
            ? { amountCents: Math.round(parseFloat(amounts[tier.id] || '0') * 100) }
            : {}),
        },
        token,
      );
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't start checkout. Please try again.",
      );
      setPendingTierId(null);
    }
  }

  async function openPortal() {
    if (!token || !orgId) return;
    setError(null);
    try {
      const { url } = await api.stripe.createPortal(
        orgId,
        { returnUrl: `${window.location.origin}/member/billing` },
        token,
      );
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't open the billing portal.",
      );
    }
  }

  if (isLoading || tiersLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="card">
        <PageHeader
          title="No membership found"
          description="You&apos;re not currently a member of an organization, so there are no dues to manage."
        />
      </div>
    );
  }

  const status = STATUS_COPY[membership.subscriptionStatus] ?? STATUS_COPY.NONE;
  const hasBillingAccount = membership.subscriptionStatus !== 'NONE';

  // A member with a live subscription changes tier through the Stripe Billing
  // Portal, never by checking out again — a second checkout creates a second
  // subscription and bills them twice. The API rejects it with a 409 too; this
  // just avoids offering a button that cannot work.
  const mustUsePortal = ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(
    membership.subscriptionStatus,
  );

  return (
    <div>
      <p className="data mb-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
        {membership.org?.name}
      </p>
      <PageHeader
        title="Dues &amp; billing"
      />{justReturned === 'success' && (
        <div className="card mt-6 flex gap-3 border-[var(--success)]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]" />
          <div>
            <p className="font-semibold">Payment received</p>
            <p className="text-sm text-[var(--text-secondary)]">
              Your membership is being activated. This page updates within a minute or two —
              Stripe confirms the payment to us in the background.
            </p>
          </div>
        </div>
      )}

      {justReturned === 'canceled' && (
        <div className="card mt-6 text-sm text-[var(--text-secondary)]">
          Checkout was canceled. Nothing has been charged.
        </div>
      )}

      {error && (
        <div className="card mt-6 flex gap-3 border-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger)]" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Current status */}
      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-[var(--text-tertiary)]" />
              <span className="font-semibold">Current status</span>
              <span className={status.tone}>{status.label}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{status.detail}</p>
          </div>

          {hasBillingAccount && (
            <button onClick={openPortal} className="btn-secondary inline-flex items-center gap-2">
              Manage billing
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Tier chooser */}
      <h2 className="mt-10 font-display text-lg">
        {mustUsePortal ? 'Change your tier' : 'Choose a tier'}
      </h2>

      {mustUsePortal ? (
        <div className="card mt-4">
          <p className="text-[var(--text-secondary)]">
            Switching tiers, updating your card, and cancelling all happen in the
            billing portal, so your existing membership is adjusted rather than a
            second one being started alongside it. Any difference in price is
            prorated automatically.
          </p>
          <button
            onClick={openPortal}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            Open billing portal
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
      {(!tiers || tiers.length === 0) && (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {membership.org?.name} hasn&apos;t set up membership tiers yet.
        </p>
      )}

      <div className="mt-4 grid gap-4">
        {(tiers ?? []).map((tier) => {
          const floorCents = Math.max(tier.minPrice ?? 0, 50);
          const raw = amounts[tier.id] ?? '';
          const enteredCents = Math.round(parseFloat(raw || '0') * 100);
          const belowFloor = tier.isPayWhatYouCan && raw !== '' && enteredCents < floorCents;
          const canSubmit = tier.isPayWhatYouCan ? raw !== '' && !belowFloor : true;
          const busy = pendingTierId === tier.id;

          return (
            <div key={tier.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{tier.name}</h3>
                    {tier.isPayWhatYouCan && (
                      <span className="badge-info">Pay what you can</span>
                    )}
                  </div>
                  {tier.description && (
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{tier.description}</p>
                  )}
                </div>

                {!tier.isPayWhatYouCan && (
                  <div className="whitespace-nowrap text-right">
                    <span className="data text-xl font-semibold">{money(tier.priceMonthly)}</span>
                    <span className="text-sm text-[var(--text-tertiary)]">/month</span>
                  </div>
                )}
              </div>

              {tier.isPayWhatYouCan && (
                <div className="mt-4">
                  <label
                    htmlFor={`amount-${tier.id}`}
                    className="block text-sm font-medium"
                  >
                    What can you pay each month?
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[var(--text-tertiary)]">$</span>
                    <input
                      id={`amount-${tier.id}`}
                      type="number"
                      inputMode="decimal"
                      min={floorCents / 100}
                      step="0.01"
                      value={raw}
                      onChange={(e) =>
                        setAmounts((a) => ({ ...a, [tier.id]: e.target.value }))
                      }
                      placeholder={(floorCents / 100).toFixed(2)}
                      aria-describedby={`hint-${tier.id}`}
                      className="input w-32"
                    />
                    <span className="text-sm text-[var(--text-tertiary)]">per month</span>
                  </div>
                  <p
                    id={`hint-${tier.id}`}
                    className={`mt-2 text-xs ${
                      belowFloor ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]'
                    }`}
                  >
                    {belowFloor
                      ? `Please enter at least ${money(floorCents)}.`
                      : `Minimum ${money(floorCents)}. Pay more if you can, less if you can't — it's the same membership either way.`}
                  </p>
                </div>
              )}

              <div className="mt-4">
                <button
                  onClick={() => startCheckout(tier)}
                  disabled={!canSubmit || busy}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {busy ? 'Opening checkout…' : `Continue with ${tier.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}

      <p className="mt-8 text-xs text-[var(--text-tertiary)]">
        Payments are handled by Stripe. MaybeOS never sees your card details.
      </p>
    </div>
  );
}
