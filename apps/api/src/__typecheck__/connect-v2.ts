/**
 * Compile-time proof that the Connect v2 parameter shapes are real.
 *
 * The Connect calls cannot be executed until Stripe Connect is enabled on the
 * MaybeOS account, so this file does the next best thing: it asserts that the
 * SDK's generated types — produced from Stripe's own OpenAPI spec — reject
 * plausible-but-wrong values. If `dashboard: 'standard'` compiled, the types
 * would not be constraining anything and `dashboard: 'full'` in
 * connect.service.ts would be worth no more than a comment.
 */
import Stripe from 'stripe';

const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2026-07-29.dahlia' });

export async function shapesAreConstrained() {
  await stripe.v2.core.accounts.create({
    display_name: 'x',
    // @ts-expect-error 'standard' is a v1 account type, not a v2 dashboard value
    dashboard: 'standard',
    defaults: {
      responsibilities: {
        // @ts-expect-error must be 'stripe' | 'application'
        fees_collector: 'platform',
        losses_collector: 'stripe',
      },
    },
  });
}
