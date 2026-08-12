/**
 * OPS-09 — smoke every module against production. Read-only.
 *
 * No writes: production holds the real MaybeItsFate org with live Stripe
 * objects. What this proves is that every module's routes are wired, reach
 * the database, and fail in the way they should. A 500 anywhere is a defect;
 * a 401/403 is the guard doing its job; a 404 on a route that should exist
 * means it was never mounted.
 */
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const BASE = argOf('--base', 'https://maybeos.org/api');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const SLUG = argOf('--slug', 'maybeitsfate');
// Resolved from the public page rather than hardcoded, so this works against
// any environment.
let ORG = argOf('--org', '');

// [module, method, path, what a healthy production should answer]
const buildChecks = (ORG, SLUG) => [
  ['Health',   'GET', '/health',                          [200]],
  ['OrgOS',    'GET', `/orgs/by-slug/${SLUG}`,            [200]],
  ['OrgOS',    'GET', `/orgs/${ORG}`,                     [200]],
  ['OrgOS',    'GET', `/orgs/${ORG}/tiers`,               [200]],
  ['EventOS',  'GET', `/orgs/${ORG}/events/public`,       [200]],
  ['EventOS',  'GET', `/orgs/${ORG}/events/feed.json`,    [200]],
  ['EventOS',  'GET', `/orgs/${ORG}/events/feed.ics`,     [200]],
  ['EventOS',  'GET', `/orgs/${ORG}/events`,              [401]],
  ['EventOS',  'GET', `/orgs/${ORG}/events/my-rsvps`,     [401]],
  ['SpaceOS',  'GET', `/orgs/${ORG}/rooms`,               [401]],
  ['SpaceOS',  'GET', `/orgs/${ORG}/my-bookings`,         [401]],
  ['CommonsOS','GET', `/orgs/${ORG}/channels`,            [401]],
  ['CommonsOS','GET', `/orgs/${ORG}/proposals`,           [401]],
  ['CommonsOS','GET', `/orgs/${ORG}/dms`,                 [401]],
  ['CommonsOS','GET', `/orgs/${ORG}/search?q=a`,          [401]],
  ['MemberOS', 'GET', `/orgs/${ORG}/members`,             [401]],
  ['MemberOS', 'GET', `/orgs/${ORG}/invitations`,         [401]],
  ['ImpactOS', 'GET', `/orgs/${ORG}/surveys`,             [401]],
  ['ImpactOS', 'GET', `/orgs/${ORG}/impact/dashboard`,    [401]],
  ['ImpactOS', 'GET', `/orgs/${ORG}/impact/demographics`, [401]],
  ['ImpactOS', 'GET', `/orgs/${ORG}/me/demographics`,     [401]],
  ['AuthOS',   'GET', '/auth/profile',                     [401]],
  // Validation, which OPS-15 changed: these must be 400, never 500.
  ['Validation','GET', `/orgs/${ORG}/events/public?from=nope`,   [400]],
  ['Validation','GET', `/orgs/${ORG}/events/public?page=0`,      [400]],
  ['Validation','GET', `/orgs/${ORG}/events/public?perPage=9999`,[400]],
  ['Validation','GET', '/orgs/by-slug/definitely-not-an-org',    [404]],
];

(async () => {
  if (!ORG) {
    const res = await fetch(`${BASE}/orgs/by-slug/${SLUG}`);
    if (!res.ok) {
      console.error(`Could not resolve org "${SLUG}" (${res.status}). Pass --org <uuid>.`);
      process.exit(2);
    }
    ORG = (await res.json()).id;
  }

  const checks = buildChecks(ORG, SLUG);
  const bad = [];
  let lastModule = '';
  for (const [mod, method, path, want] of checks) {
    await pause(400);
    let status, body = '';
    try {
      const res = await fetch(`${BASE}${path}`, { method });
      status = res.status;
      body = (await res.text()).slice(0, 90);
    } catch (e) {
      status = 'ERR';
      body = e.message;
    }
    const ok = want.includes(status);
    if (mod !== lastModule) { console.log(''); lastModule = mod; }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(status).padEnd(4)} ${mod.padEnd(11)} ${path}`);
    if (!ok) bad.push({ mod, path, status, want, body });
  }

  console.log('\n' + '='.repeat(70));
  if (bad.length === 0) {
    console.log(`All ${checks.length} checks answered as expected.`);
    process.exit(0);
  } else {
    console.log(`${bad.length} unexpected:`);
    for (const b of bad) console.log(`  ${b.mod} ${b.path}\n     got ${b.status}, expected ${b.want.join('/')}\n     ${b.body}`);
    process.exit(1);
  }
})();
