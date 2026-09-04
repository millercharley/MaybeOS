'use client';

import Script from 'next/script';
import { PLATFORM_FEE_CENTS, money } from '@/lib/fees';

/**
 * What this co-op pays MaybeOS, and how to change it (PLT-02).
 *
 * Stripe's own hosted pricing table rather than a page of our own. The plans,
 * prices and the monthly/yearly switch are all edited in Stripe, so a price
 * change is a Stripe change and not a deploy — and the checkout that follows
 * is Stripe's, which is the only way MaybeOS never touches a card number.
 *
 * `client-reference-id` is the load-bearing attribute: it is the co-op's id,
 * handed back on the completed checkout, and it is the only thing that says
 * *which* co-op subscribed. Without it a payment arrives with no way to know
 * whose plan to change.
 *
 * The publishable key is publishable by design — it identifies the Stripe
 * account to a browser and cannot move money.
 */
export function MaybeOsPlan({
  org,
  memberCount,
}: {
  org: { id: string; name: string; plan?: string; billingWaived?: boolean };
  /** Billable memberships — organisers, staff and members; guests excluded. */
  memberCount?: number;
}) {
  const plan = org.plan ?? 'FREE';
  const perTransaction = PLATFORM_FEE_CENTS[plan] ?? PLATFORM_FEE_CENTS.FREE;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Your MaybeOS plan</h2>
        <p className="mt-1 text-sm text-gray-500">
          {org.name} is on <b>{plan === 'FREE' ? 'MaybeOS Free' : plan === 'PLUS' ? 'MaybeOS Plus' : 'MaybeOS Unlimited'}</b>.
        </p>
      </div>

      {/* The number that actually moves with the plan, said before the table
          rather than left to be discovered on a ticket. */}
      <div className="rounded-lg bg-gray-50 p-4 text-sm">
        <p className="text-gray-900">
          <b>{money(perTransaction)}</b> is added to every transaction on this plan — ticket
          sales, and anything else the co-op sells through MaybeOS.
        </p>
        <p className="mt-1 text-gray-500">
          It is added on top of your price rather than taken out of it, so a $10 ticket still
          pays you $10 and the buyer sees the fee named. A higher plan lowers it:{' '}
          {money(PLATFORM_FEE_CENTS.FREE)} on Free, {money(PLATFORM_FEE_CENTS.PLUS)} on Plus,{' '}
          {money(PLATFORM_FEE_CENTS.UNLIMITED)} on Unlimited.
        </p>
      </div>

      {/* What a per-member plan is counting, said out loud (PLT-03). "Why is
          this $150?" should be answerable on this page rather than by writing
          to support — and the count is a snapshot taken at renewal, so a co-op
          that grows mid-period should not be surprised either way. */}
      {plan === 'PLUS' && memberCount !== undefined && (
        <div className="rounded-lg border border-gray-200 p-4 text-sm">
          <p className="text-gray-900">
            Billed for <b>{memberCount}</b> {memberCount === 1 ? 'member' : 'members'}.
          </p>
          <p className="mt-1 text-gray-500">
            Organizers, staff and members — <b>guests aren&apos;t counted</b>. The number is taken
            when your plan renews, so joiners and leavers in between don&apos;t change the bill
            you&apos;re looking at.
          </p>
        </div>
      )}

      {org.billingWaived && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          MaybeOS is free for {org.name} — you won&apos;t be charged for your plan. The
          per-transaction fee above still applies to ticket sales.
        </p>
      )}

      <Script src="https://js.stripe.com/v3/pricing-table.js" strategy="lazyOnload" />
      <stripe-pricing-table
        pricing-table-id="prctbl_1U95dxD14bhghVE2zVs4YqaT"
        publishable-key="pk_live_51U2yA7D14bhghVE2SzHjDWPYVbTcpSVPDXPXMRZP98SFRUl74un053QjFp5qu7hANSDHbbV0myCv3tVeMzjgwByy00WTPxtJq0"
        client-reference-id={org.id}
      />
    </section>
  );
}
