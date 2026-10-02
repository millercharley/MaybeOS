import Stripe from 'stripe';

/**
 * Turning a Stripe invoice into a dues payment MaybeOS can add up (RCP-01).
 *
 * Pure, because this is the part that is easy to get subtly wrong and
 * impossible to notice: an invoice carries half a dozen plausible amounts —
 * `total`, `subtotal`, `amount_due`, `amount_paid` — and picking the wrong
 * one produces a recap that is confidently off by the MaybeOS fee, or by a
 * credit, every month, with nothing failing.
 *
 * **`amount_paid` is the one that is true.** It is what actually moved. A
 * total is what was asked for, and the two differ whenever a credit note, a
 * proration or a discount is involved.
 */

export interface DuesPaymentRecord {
  stripeInvoiceId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  amountCents: number;
  feeCents: number;
  currency: string;
  paidAt: Date;
  /** Who Stripe billed, as the invoice recorded it. */
  invoiceName: string | null;
  invoiceEmail: string | null;
}

/** A member, as much of one as a payment needs to remember. */
export interface Payer {
  payerName: string | null;
  payerEmail: string | null;
}

/**
 * Who to write on the payment (PAY-10).
 *
 * The membership is preferred, because that is who MaybeOS believes the payer
 * is and what an organiser would recognise. The invoice is the fallback, and
 * it is the only answer for a payment adopted from a subscription MaybeOS
 * never issued — the case where the question "who was this?" is hardest and
 * matters most.
 *
 * Nulls all the way down rather than a placeholder: "Unknown" in this column
 * would be indistinguishable from somebody actually called that, and a blank
 * is at least honest about being blank.
 */
export function payerFrom(
  member: { name?: string | null; email?: string | null } | null | undefined,
  invoice: { invoiceName: string | null; invoiceEmail: string | null },
): Payer {
  const clean = (value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : trimmed;
  };

  return {
    payerName: clean(member?.name) ?? clean(invoice.invoiceName),
    payerEmail: clean(member?.email) ?? clean(invoice.invoiceEmail),
  };
}

/** The subscription an invoice belongs to, across SDK versions. */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  // `invoice.subscription` was removed between acacia and dahlia; it now
  // hangs off `parent.subscription_details`. The old path is simply
  // `undefined` on dahlia, which is how the same change silently broke
  // dunning once already — see `handleInvoicePaymentFailed`.
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === 'string') return parent;
  if (parent?.id) return parent.id;
  return null;
}

function customerIdOf(invoice: Stripe.Invoice): string | null {
  const customer = invoice.customer;
  if (typeof customer === 'string') return customer;
  if (customer && 'id' in customer) return customer.id;
  return null;
}

/**
 * What MaybeOS took of it: PAY-09's application fee, zero on Plus and
 * Unlimited. Read from the invoice rather than recomputed from the plan,
 * because the fee that was actually charged is a fact and the fee the plan
 * implies today is a guess about the past.
 */
function feeOf(invoice: Stripe.Invoice): number {
  const fee = (invoice as unknown as { application_fee_amount?: number | null })
    .application_fee_amount;
  return typeof fee === 'number' && fee > 0 ? fee : 0;
}

/**
 * A paid dues invoice, or null when it is not one of ours to record.
 *
 * Refuses: anything not paid, anything for nothing (a $0 invoice from a
 * trial or a fully discounted period is not revenue), and anything with no
 * subscription behind it — a one-off invoice is not dues.
 */
export function duesPaymentFrom(invoice: Stripe.Invoice): DuesPaymentRecord | null {
  if (!invoice.id) return null;
  if (invoice.status !== 'paid') return null;

  const amountCents = invoice.amount_paid ?? 0;
  if (amountCents <= 0) return null;

  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) return null;

  // `status_transitions.paid_at` is when it was paid; `created` is when it was
  // written. A recap is a statement about a month, so it has to be the former,
  // and an invoice paid late belongs to the month the money moved.
  const paidAtSeconds = invoice.status_transitions?.paid_at ?? invoice.created;

  return {
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerIdOf(invoice),
    amountCents,
    feeCents: feeOf(invoice),
    currency: invoice.currency ?? 'usd',
    paidAt: new Date(paidAtSeconds * 1000),
    invoiceName: invoice.customer_name ?? null,
    invoiceEmail: invoice.customer_email ?? null,
  };
}
