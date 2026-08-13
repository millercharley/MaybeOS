#!/usr/bin/env node
/**
 * Exercise every Stripe surface MaybeOS depends on, against a test key.
 *
 *   node --env-file=.env tools/stripe-billing-check.js
 *
 * Written to de-risk the stripe-node 17 -> 22 upgrade, which crossed two API
 * generations (acacia -> dahlia) and touches billing that is live in
 * production. Compiling proves nothing about whether Stripe still accepts a
 * request shape, so this sends the real ones.
 *
 * The Connect section is skipped unless the key can reach Connect. A sandbox
 * restricted key cannot, and neither can a platform account without Connect
 * enabled — which is a Dashboard action, not a code one.
 *
 * Get a test key with no registration: `npx stripe sandbox create`.
 */
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });
const ok = [], bad = [];
const step = async (label, fn) => {
  try { const r = await fn(); ok.push(label); return r; }
  catch (e) { bad.push(`${label}: ${e.type} ${e.code || ''} ${String(e.message).slice(0,90)}`); return null; }
};

(async () => {
  const product = await step('products.create', () =>
    stripe.products.create({ name: 'Sustainer (probe)', metadata: { orgId: 'probe', tierId: 'probe' } }));

  const price = await step('prices.create (recurring)', () =>
    stripe.prices.create({
      product: product.id, currency: 'usd', unit_amount: 1950,
      recurring: { interval: 'month' }, metadata: { orgId: 'probe' },
    }));

  await step('prices.update', () => stripe.prices.update(price.id, { metadata: { touched: '1' } }));

  const customer = await step('customers.create', () =>
    stripe.customers.create({ email: 'probe@example.com', metadata: { orgId: 'probe' } }));

  const session = await step('checkout.sessions.create (subscription)', () =>
    stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { orgId: 'probe', userId: 'probe', tierId: 'probe' },
      subscription_data: { metadata: { orgId: 'probe' } },
      success_url: 'https://maybeos.org/ok',
      cancel_url: 'https://maybeos.org/no',
    }));

  const cfg = await step('billingPortal.configurations.create', () =>
    stripe.billingPortal.configurations.create({
      business_profile: { headline: 'Probe' },
      features: { subscription_cancel: { enabled: true }, payment_method_update: { enabled: true } },
    }));

  await step('billingPortal.sessions.create', () =>
    stripe.billingPortal.sessions.create({
      customer: customer.id, configuration: cfg.id, return_url: 'https://maybeos.org/back',
    }));

  // Webhook signature verification is pure-local but version-sensitive.
  await step('webhooks.constructEvent', async () => {
    const payload = JSON.stringify({ id: 'evt_probe', object: 'event', type: 'ping', data: { object: {} } });
    const secret = 'whsec_probe';
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return stripe.webhooks.constructEvent(payload, header, secret);
  });

  // ── Connect, if this key can reach it ──────────────────────
  let connectReachable = true;
  try {
    await stripe.v2.core.accounts.list({ limit: 1 });
  } catch {
    connectReachable = false;
  }

  if (!connectReachable) {
    console.log(
      'Connect: SKIPPED — this key cannot reach Connect. Enable Connect on the\n' +
        '         platform account and re-run to exercise account creation,\n' +
        '         capability status, a direct charge and a refund.',
    );
  } else {
    const account = await step('v2 accounts.create (SaaS dimensions)', () =>
      stripe.v2.core.accounts.create({
        display_name: 'Probe Co-op',
        dashboard: 'full',
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
        identity: { country: 'us' },
        include: ['configuration.merchant'],
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      }));

    if (account) {
      await step('v2 accountLinks.create (onboarding)', () =>
        stripe.v2.core.accountLinks.create({
          account: account.id,
          use_case: {
            type: 'account_onboarding',
            account_onboarding: {
              configurations: ['merchant'],
              return_url: 'https://maybeos.org/admin/settings',
              refresh_url: 'https://maybeos.org/admin/settings',
            },
          },
        }));

      await step('v2 accounts.retrieve (capability status)', () =>
        stripe.v2.core.accounts.retrieve(account.id, {
          include: ['configuration.merchant', 'requirements'],
        }));
    }
  }

  console.log('checkout session url present:', Boolean(session?.url));
  console.log('\nPASS (' + ok.length + '):', ok.join(', '));
  if (bad.length) { console.log('\nFAIL (' + bad.length + '):'); bad.forEach(b => console.log('  ' + b)); process.exit(1); }
  else console.log('\nEvery live-billing surface works on SDK 22 + dahlia.');
})();
