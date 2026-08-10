/**
 * Does a Stripe webhook survive the Netlify Function path?
 *
 * The open question for PAY-01: signature verification needs the exact raw
 * bytes Stripe signed, and between Stripe and Nest sits Netlify's event
 * envelope plus serverless-http. If either mangles the body — re-encoding it,
 * or parsing it to JSON before Nest sees it — constructEvent fails and every
 * webhook 400s in production while working perfectly on localhost.
 *
 * This drives the real compiled handler (dist/lambda.js), not a mock, so it
 * exercises lambda.ts -> normalizePath -> serverless-http -> Nest rawBody ->
 * stripe.webhooks.constructEvent exactly as production would.
 *
 * Netlify may deliver the body as UTF-8 or base64 depending on content type
 * and size, so both are tested.
 *
 * Run after `npm run build`:
 *   node scripts/verify-netlify-webhook.js
 *
 * Caveat: this runs the compiled handler in a local Node process. It faithfully
 * covers the raw-body risk (serverless-http re-encoding the payload) but not
 * Netlify's own runtime or the esbuild bundling step.
 */
const path = require('path');
const API = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(API, '.env') });
const Stripe = require('stripe');

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error('STRIPE_WEBHOOK_SECRET not set');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// A realistic event. Unknown-but-valid type so no DB rows are touched: we are
// testing signature verification, not the handlers.
function makeEvent() {
  return JSON.stringify({
    id: `evt_netlifytest_${Date.now()}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'ping.test',
    data: { object: { id: 'obj_test', note: 'Netlify raw-body probe — unicode ✓ é 日本' } },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
}

async function run(label, encode) {
  const payload = makeEvent();
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const event = {
    path: '/.netlify/functions/api/stripe/webhooks',
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header,
      host: 'maybeos.org',
    },
    body: encode ? Buffer.from(payload, 'utf8').toString('base64') : payload,
    isBase64Encoded: encode,
    rawUrl: 'https://maybeos.org/api/stripe/webhooks',
  };

  const { handler } = require(path.join(API, 'dist', 'lambda'));
  const res = await handler(event, { callbackWaitsForEmptyEventLoop: true });

  const ok = res.statusCode === 200;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`   status: ${res.statusCode}`);
  console.log(`   body:   ${String(res.body).slice(0, 160)}`);
  return ok;
}

(async () => {
  console.log('Driving the real compiled Netlify handler with Stripe-signed payloads.');
  const plain = await run('body as UTF-8 (isBase64Encoded: false)', false);
  const b64 = await run('body as base64 (isBase64Encoded: true)', true);

  console.log('\n─────────────────────────────────────────');
  console.log(`  UTF-8 body:  ${plain ? 'signature verified' : 'REJECTED'}`);
  console.log(`  base64 body: ${b64 ? 'signature verified' : 'REJECTED'}`);
  process.exit(plain && b64 ? 0 : 1);
})().catch((e) => {
  console.error('harness error:', e.message);
  process.exit(2);
});
