#!/usr/bin/env node
/**
 * OPS-09 — exercise the write paths against production, inside a tenant that
 * exists only for the length of the run.
 *
 * `tools/prod-smoke.js` covers reads: every route resolves, reaches the
 * database and refuses correctly. It cannot cover writes, so no write path had
 * ever run in production — and the `allowPublicJoin` outage is what that costs
 * when it bites, since a client-rendered shell answers 200 over a 500 nobody
 * sees.
 *
 * Containment, because this writes to the real database:
 *
 *   - every row is created inside a throwaway org and torn down at the end;
 *   - MaybeItsFate's own org is never written to, and its id is asserted
 *     against before anything runs;
 *   - **no Stripe path is exercised.** Creating a tier calls
 *     `createStripePricesForTier`, which provisions a real Product and Price
 *     in live mode. Tiers, checkout and ticketing are deliberately excluded —
 *     a test that leaves live Stripe objects behind is not a test.
 *
 * Run: node tools/prod-write-probe.js
 */

const API = process.env.PROBE_API || 'https://maybeos.org/api';
const STAMP = Date.now();
const MARK = `ops09-${STAMP}`;

const results = [];
let token = null;
let orgId = null;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(name, path, { method = 'GET', body, auth = true } = {}) {
  // The global limiter is 100/60s and this suite is small; the pause keeps a
  // burst from turning a real failure into an indistinguishable 429.
  await pause(500);
  let res, json;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = text.slice(0, 200);
    }
  } catch (err) {
    results.push({ name, ok: false, status: 'NETWORK', detail: err.message });
    return { ok: false, json: null };
  }

  const ok = res.status < 400;
  results.push({
    name,
    ok,
    status: res.status,
    detail: ok ? '' : JSON.stringify(json).slice(0, 160),
  });
  return { ok, status: res.status, json };
}

(async () => {
  console.log(`OPS-09 write probe against ${API}`);
  console.log(`Everything created is tagged ${MARK}\n`);

  // ── Identity ──────────────────────────────────────────────────────────
  const email = `${MARK}@maybeos-probe.invalid`;
  const reg = await call('register a new account', '/auth/register', {
    method: 'POST',
    auth: false,
    body: { email, password: 'probe-password-8chars', name: 'OPS-09 Probe' },
  });
  if (!reg.ok) return finish('registration failed, nothing else could run');

  const login = await call('sign in with it', '/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password: 'probe-password-8chars' },
  });
  if (!login.ok) return finish('login failed');
  token = login.json.accessToken;

  // ── Tenancy ───────────────────────────────────────────────────────────
  const org = await call('create an organisation', '/orgs', {
    method: 'POST',
    body: { name: `OPS-09 Probe ${STAMP}`, slug: MARK, timezone: 'America/New_York' },
  });
  if (!org.ok) return finish('org creation failed');
  orgId = org.json.id;

  if (!orgId) return finish('org created without an id in the response');

  // The JWT was minted before this org existed, so it carries no role for it
  // and every guarded write would answer 403. The web app does the same thing
  // after onboarding; skipping it here would report a product defect that is
  // really a stale token.
  const refreshed = await call('refresh the token onto the new org', '/auth/refresh', {
    method: 'POST',
  });
  if (!refreshed.ok) return finish('token refresh failed');
  token = refreshed.json.accessToken;

  console.log(`  working inside org ${orgId}\n`);

  // ── SpaceOS: the module that has never had a booking in production ────
  const room = await call('create a room', `/orgs/${orgId}/rooms`, {
    method: 'POST',
    body: { name: 'Probe Room', capacity: 4, requiresApproval: false },
  });

  if (room.ok) {
    const start = new Date(Date.now() + 30 * 864e5);
    start.setUTCHours(15, 0, 0, 0);
    const end = new Date(start.getTime() + 36e5);
    const booking = await call('book that room', `/orgs/${orgId}/rooms/${room.json.id}/bookings`, {
      method: 'POST',
      body: {
        title: 'Probe booking',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
    });
    if (booking.ok) {
      await call('cancel the booking', `/orgs/${orgId}/bookings/${booking.json.id}/cancel`, {
        method: 'POST',
      });
    }
  }

  // ── EventOS ───────────────────────────────────────────────────────────
  const evStart = new Date(Date.now() + 31 * 864e5);
  const event = await call('create an event', `/orgs/${orgId}/events`, {
    method: 'POST',
    body: {
      title: 'Probe event',
      startTime: evStart.toISOString(),
      endTime: new Date(evStart.getTime() + 36e5).toISOString(),
      visibility: 'MEMBERS_ONLY',
      capacity: 1,
      waitlistEnabled: true,
      priceCents: null,
      publish: true,
    },
  });

  if (event.ok) {
    await call('RSVP to it', `/orgs/${orgId}/events/${event.json.id}/rsvp`, { method: 'POST' });
  }

  // ── CommonsOS ─────────────────────────────────────────────────────────
  const channel = await call('create a channel', `/orgs/${orgId}/channels`, {
    method: 'POST',
    body: { name: 'probe-channel', description: 'OPS-09' },
  });

  if (channel.ok) {
    const post = await call('post in it', `/orgs/${orgId}/channels/${channel.json.id}/posts`, {
      method: 'POST',
      body: { body: 'OPS-09 write probe.' },
    });
    if (post.ok) {
      await call('comment on the post', `/orgs/${orgId}/posts/${post.json.id}/comments`, {
        method: 'POST',
        body: { body: 'And a reply.' },
      });
    }
  }

  // ── Org settings, the write that caused the last outage ───────────────
  await call('toggle allowPublicJoin', `/orgs/${orgId}`, {
    method: 'PATCH',
    body: { allowPublicJoin: true },
  });

  finish();
})();

function finish(fatal) {
  console.log('─'.repeat(62));
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${String(r.status).padEnd(8)} ${r.name}`);
    if (!r.ok && r.detail) console.log(`          ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log('─'.repeat(62));
  if (fatal) console.log(`stopped early: ${fatal}`);
  console.log(
    failed.length
      ? `${failed.length} of ${results.length} write paths failed.`
      : `All ${results.length} write paths succeeded.`,
  );
  console.log(`\nTeardown needs org id: ${orgId || '(none created)'}`);
  console.log(`Tag for anything left behind: ${MARK}`);
  process.exit(failed.length ? 1 : 0);
}
