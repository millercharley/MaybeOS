#!/usr/bin/env node
/**
 * Check `apps/web/lib/api.ts` against what the API actually returns.
 *
 * Those interfaces are the web's only description of every response it reads,
 * and nothing verifies them. Four times now a type has described an endpoint
 * that does not exist — `Proposal.votes`, `UserProfile.orgName`,
 * `Event.rsvpCount`, the whole of `ImpactDashboardData` — and because a
 * missing field reads as `undefined` rather than throwing, the UI renders a
 * blank or a zero and looks merely empty. This diffs the declarations against
 * live payloads so the mismatch is loud.
 *
 * Both directions matter. *Declared but never sent* is the blank-UI kind.
 * *Sent but undeclared* is the leak kind — it is what caught the co-op's
 * Google Calendar refresh token shipping to the browser.
 *
 *   node tools/type-sweep.js [--api http://localhost:3001/api]
 *
 * Wants an API running against a seeded database, since a type can only be
 * checked where there is a row to return. Types reported as "no sample" were
 * not checked at all — that is a gap in the seed, not a pass.
 */
const fs = require('fs');
const path = require('path');

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const API = argOf('--api', 'http://localhost:3001/api');
const EMAIL = argOf('--email', 'maya@sunrise.coop');
const PASSWORD = argOf('--password', 'password123');
const API_TS = path.join(__dirname, '..', 'apps', 'web', 'lib', 'api.ts');

/** The global rate limiter is 100/60s; probes are slow on purpose. */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function declaredInterfaces() {
  const src = fs.readFileSync(API_TS, 'utf8');
  const out = {};
  for (const m of src.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)) {
    out[m[1]] = [...m[2].matchAll(/^\s{2}(\w+)\??:/gm)].map((f) => f[1]);
  }
  return out;
}

async function main() {
  const declared = declaredInterfaces();

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`Could not sign in as ${EMAIL} (${login.status}). Is the API running and seeded?`);
    process.exit(2);
  }
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const profile = await (await fetch(`${API}/auth/profile`, { headers })).json();
  const orgId = profile.orgs[0].orgId;
  const orgSlug = profile.orgs[0].org.slug;

  const get = async (p, authed = true) => {
    await pause(700);
    const res = await fetch(`${API}${p}`, { headers: authed ? headers : {} });
    return res.ok ? res.json() : { __error: res.status };
  };
  /** Lists come back either bare or paginated; a type describes one element. */
  const first = (v) => (Array.isArray(v) ? v[0] : (v?.data?.[0] ?? v));

  const cases = [
    ['Org', () => get(`/orgs/by-slug/${orgSlug}`, false)],
    ['MembershipTier', async () => first(await get(`/orgs/${orgId}/tiers`))],
    ['Member', async () => first(await get(`/orgs/${orgId}/members`))],
    ['Invitation', async () => first(await get(`/orgs/${orgId}/invitations`))],
    ['MyRsvp', async () => first(await get(`/orgs/${orgId}/events/my-rsvps`))],
    ['Event', async () => first(await get(`/orgs/${orgId}/events`))],
    ['Room', async () => first(await get(`/orgs/${orgId}/rooms`))],
    // Per-room rather than /my-bookings: the seeded bookings belong to other
    // members, so the signed-in user's own list is empty and checks nothing.
    // `room` is reported missing here and that is correct — only /my-bookings
    // embeds it, which is why the field is optional.
    [
      'Booking',
      async () => {
        const room = first(await get(`/orgs/${orgId}/rooms`));
        if (!room?.id) return null;
        // `from`/`to` are mandatory: without them the route builds an Invalid
        // Date and answers 500 rather than 400.
        const from = new Date(Date.now() - 365 * 864e5).toISOString();
        const to = new Date(Date.now() + 365 * 864e5).toISOString();
        return first(
          await get(`/orgs/${orgId}/rooms/${room.id}/bookings?from=${from}&to=${to}`),
        );
      },
    ],
    ['Channel', async () => first(await get(`/orgs/${orgId}/channels`))],
    ['Proposal', async () => first(await get(`/orgs/${orgId}/proposals`))],
    ['Collection', async () => first(await get(`/orgs/${orgId}/collections`))],
    ['SearchResults', () => get(`/orgs/${orgId}/search?q=a`)],
    ['Survey', async () => first(await get(`/orgs/${orgId}/surveys`))],
    ['ImpactDashboardData', () => get(`/orgs/${orgId}/impact/dashboard`)],
    ['DmConversation', async () => first(await get(`/orgs/${orgId}/dms`))],
  ];

  const fictions = [];
  const unchecked = [];

  for (const [type, fetcher] of cases) {
    const fields = declared[type];
    if (!fields) {
      unchecked.push(`${type} (no such interface in api.ts)`);
      continue;
    }

    const actual = await fetcher();
    if (!actual || actual.__error) {
      unchecked.push(`${type} (${actual?.__error ?? 'no rows in the seed'})`);
      console.log(`${type.padEnd(22)} NOT CHECKED`);
      continue;
    }

    const present = Object.keys(actual);
    const missing = fields.filter((f) => !present.includes(f));
    const extra = present.filter((p) => !fields.includes(p));

    console.log(
      `${type.padEnd(22)}${(missing.length ? 'MISMATCH' : 'ok').padEnd(10)}` +
        (missing.length ? `declared but never sent: ${missing.join(', ')}` : '') +
        (extra.length ? `${missing.length ? ' | ' : ''}sent but undeclared: ${extra.join(', ')}` : ''),
    );
    if (missing.length) fictions.push({ type, missing });
  }

  console.log('\n' + '='.repeat(72));
  if (fictions.length) {
    console.log(`${fictions.length} type(s) declare fields the API never sends:`);
    for (const f of fictions) console.log(`  ${f.type}: ${f.missing.join(', ')}`);
    console.log('\nEach one reads as undefined in the UI. Grep for consumers before deleting.');
  } else {
    console.log('No declared field went unsent.');
  }
  if (unchecked.length) {
    console.log(`\nNot checked (no sample to compare against): ${unchecked.join(', ')}`);
  }
  console.log(
    '\nReview the "sent but undeclared" column by eye — that is where secrets\n' +
      'leave the server. It is how Room.googleTokens was found.',
  );

  process.exit(fictions.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
