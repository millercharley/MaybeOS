const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');

function makeSheet(name) {
  const rows = []; // array of arrays, row 1 = index 0
  const sh = {
    rows, getName: () => name,
    getLastRow: () => { let n = rows.length; while (n && rows[n-1].every(v => v === '' || v == null)) n--; return n; },
    getMaxRows: () => Math.max(rows.length, 1000),
    insertRowsAfter: () => {},
    setFrozenRows: () => {}, getProtections: () => [],
    appendRow: r => { rows[sh.getLastRow()] = r.map(v => (typeof v === 'string' && /^=/.test(v)) ? { FORMULA: v } : v); },
    getRange(r, c, nr = 1, nc = 1) {
      const chain = { setNumberFormat: () => chain, setFontWeight: () => chain,
        insertCheckboxes: () => { if (r === 'D2:D') for (let i = 1; i < 1000; i++) { rows[i] = rows[i] || []; if (rows[i][3] == null || rows[i][3] === '') rows[i][3] = false; } return chain; },
        protect: () => ({ setDescription() { return this; }, setWarningOnly() { return this; } }) };
      if (typeof r === 'string') return chain;
      return Object.assign(chain, {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = rows[r-1+i] || []; const v = row[c-1+j]; return v == null ? '' : v; })),
        setValues: vals => vals.forEach((vr, i) => { rows[r-1+i] = rows[r-1+i] || []; vr.forEach((v, j) => {
          if (typeof v === 'string' && /^=/.test(v)) v = { FORMULA: v };
          if (typeof v === 'string' && v[0] === "'") v = v.slice(1); // sheets keeps apostrophe as a text marker
          rows[r-1+i][c-1+j] = v; }); }) || chain,
      });
    },
  };
  return sh;
}
function env(props) {
  const sheets = {}; const cache = new Map(); const fetches = [];
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), getSheets: () => Object.values(sheets), deleteSheet: s => delete sheets[s.getName()] };
  const ctx = {
    console, Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, ProtectionType: { RANGE: 'RANGE' } },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k), removeAll: ks => ks.forEach(k => cache.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k] }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (v, k, cs) => { assert.strictEqual(cs, 'utf8'); return [...crypto.createHmac('sha256', Buffer.from(k, 'utf8')).update(Buffer.from(v, 'utf8')).digest()].map(b => b > 127 ? b - 256 : b); },
      base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
      computeDigest: (alg, v) => [...crypto.createHash('sha256').update(v, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64url'),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetches.push({ url, opts });
        if (ctx.__http && ctx.__http[url] !== undefined) {
          const reply = ctx.__http[url];
          if (reply instanceof Error) throw reply;
          return { getResponseCode: () => reply.status ?? 200, getContentText: () => reply.body ?? '' };
        }
        return { getResponseCode: () => ctx.__shellyStatus || 200, getContentText: () => '' };
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    Date, JSON, Math, Number, String, Object, Array, Boolean, isFinite, parseFloat, encodeURIComponent, RegExp,
  };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { ctx, sheets, cache, fetches, ss };
}
const SECRET = 'test-secret-ünicode';
function post(ctx, payloadObj, { secret = SECRET, ts = Date.now(), tamper = false } = {}) {
  const payload = JSON.stringify(payloadObj);
  const signature = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('base64');
  return ctx.doPost({ postData: { contents: JSON.stringify({ timestamp: ts, payload: tamper ? payload.replace('ABCDE', 'ABCDF') : payload, signature }) } });
}

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const { ctx, sheets, cache, fetches } = env({ MAYBEOS_SECRET: SECRET, SHELLY_AUTH_KEY: 'shelly-key' });
ctx.setupDoorSheet();

t('setup creates the three tabs with headers and a default door', () => {
  assert.deepStrictEqual(Object.keys(sheets).sort(), ['Access Log', 'Doors', 'Members']);
  assert.strictEqual(sheets.Members.rows[0][1], 'Door Code');
  assert.strictEqual(sheets.Doors.rows[1][0], 'side');
  assert.ok(!sheets.Doors.rows[0].some(h => /key/i.test(h)), 'no key column in Doors');
});
t('empty checkboxes fill the Revoked column like real Sheets does', () => {
  assert.strictEqual(sheets.Members.getLastRow(), 1000);
});
t('setup run twice changes nothing', () => { const before = JSON.stringify(sheets); ctx.setupDoorSheet(); assert.strictEqual(JSON.stringify(sheets), before); });

// Configure the door
sheets.Doors.rows[1] = ['side', 'Side Door', 'shelly-103-eu', 'dev123', 40.7, -74.0, true];

t('ping works with a Node-made signature (unicode secret)', () => { assert.deepStrictEqual(post(ctx, { action: 'ping' }), { ok: true, action: 'ping', members: 0 }); });
t('wrong secret refused', () => { assert.strictEqual(post(ctx, { action: 'ping' }, { secret: 'nope' }).error, 'unauthorized'); });
t('tampered payload refused', () => { assert.strictEqual(post(ctx, { action: 'upsert', members: [{ email: 'a@x.co', code: 'ABCDE', name: 'A' }] }, { tamper: true }).error, 'unauthorized'); });
t('stale timestamp refused', () => { assert.strictEqual(post(ctx, { action: 'ping' }, { ts: Date.now() - 6 * 60 * 1000 }).error, 'stale'); });
t('unconfigured secret refused', () => { const e2 = env({}); assert.strictEqual(post(e2.ctx, { action: 'ping' }).error, 'not_configured'); });
t('garbage body refused', () => { assert.strictEqual(ctx.doPost({ postData: { contents: 'nope' } }).error, 'bad_request'); assert.strictEqual(ctx.doPost(undefined).error, 'bad_request'); });

t('upsert adds members, rejects bad codes and duplicates, neutralises formulas', () => {
  const r = post(ctx, { action: 'upsert', members: [
    { email: 'Ada@Example.com', code: 'abcde', name: 'Ada Lovelace', revoked: false },
    { email: 'bob@example.com', code: 'QWERT', name: '=IMPORTDATA("https://evil")', revoked: false },
    { email: 'bad@example.com', code: 'ABC1E', name: 'Has a digit' },
    { email: 'short@example.com', code: 'ABCD', name: 'Too short' },
    { email: 'ada@example.com', code: 'ZZZZZ', name: 'Dupe' },
    { email: 'noat', code: 'ABCDE', name: 'No at' },
  ] });
  assert.deepStrictEqual(r, { ok: true, action: 'upsert', updated: 0, added: 2, unchanged: 0, rejected: 4 });
  assert.strictEqual(sheets.Members.rows[1][0], 'ada@example.com', 'first member lands in row 2, not below the checkboxes');
  assert.strictEqual(sheets.Members.rows[2][0], 'bob@example.com');
  assert.deepStrictEqual(post(ctx, { action: 'ping' }), { ok: true, action: 'ping', members: 2 });
  assert.strictEqual(sheets.Members.rows[1][1], 'ABCDE');
  assert.strictEqual(typeof sheets.Members.rows[2][2], 'string', 'name stored as text, not a formula');
  assert.ok(!JSON.stringify(r).includes('ABCDE'), 'response has no codes');
});

t('member can unlock; Shelly gets the key from properties and the right payload', () => {
  const res = ctx.unlockDoor(' ADA@example.com ', 'abcde', 40.7001, -74.0001, 'side');
  assert.strictEqual(res.ok, true, res.message);
  const f = fetches.at(-1);
  assert.strictEqual(f.url, 'https://shelly-103-eu.shelly.cloud/v2/devices/api/set/switch?auth_key=shelly-key');
  assert.deepStrictEqual(JSON.parse(f.opts.payload), { id: 'dev123', channel: 0, on: true, toggle_after: 1 });
  const log = sheets['Access Log'].rows.at(-1);
  assert.strictEqual(log[3], 'Granted'); assert.match(log[7], / ft$/);
});

t('wrong code, unknown email and revoked all get the same message', () => {
  const wrong = ctx.unlockDoor('ada@example.com', 'ZZZZZ', '', '', 'side');
  const unknown = ctx.unlockDoor('nobody@example.com', 'ABCDE', '', '', 'side');
  assert.strictEqual(wrong.ok, false); assert.strictEqual(wrong.message, unknown.message);
});

t('revocation from MaybeOS takes effect immediately despite the cache', () => {
  assert.ok(cache.has('members_index_v1'), 'index was cached');
  const r = post(ctx, { action: 'upsert', members: [{ email: 'ada@example.com', code: 'ABCDE', name: 'Ada Lovelace', revoked: true }, { email: 'bob@example.com', code: 'QWERT', name: '=IMPORTDATA("https://evil")' }] });
  assert.strictEqual(r.updated, 1); assert.strictEqual(r.unchanged, 1);
  const res = ctx.unlockDoor('ada@example.com', 'ABCDE', '', '', 'side');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(sheets['Access Log'].rows.at(-1)[4], 'Revoked');
});

t('code change: old code stops, new code works', () => {
  post(ctx, { action: 'upsert', members: [{ email: 'bob@example.com', code: 'NEWCD', name: 'x' }] });
  assert.strictEqual(ctx.unlockDoor('bob@example.com', 'QWERT', '', '', 'side').ok, false);
  assert.strictEqual(ctx.unlockDoor('bob@example.com', 'NEWCD', '', '', 'side').ok, true);
});

t('hand-typed "yes" in Revoked still denies (after onEdit clears cache)', () => {
  sheets.Members.rows[2][3] = 'Yes';
  ctx.onEdit({ range: { getSheet: () => sheets.Members } });
  assert.strictEqual(ctx.unlockDoor('bob@example.com', 'NEWCD', '', '', 'side').ok, false);
  sheets.Members.rows[2][3] = false; ctx.onEdit({ range: { getSheet: () => sheets.Members } });
});

t('five failures lock the email out, even with the right code', () => {
  for (let i = 0; i < 5; i++) ctx.unlockDoor('bob@example.com', 'WRONG', '', '', 'side');
  const res = ctx.unlockDoor('bob@example.com', 'NEWCD', '', '', 'side');
  assert.strictEqual(res.ok, false); assert.match(res.message, /Too many/);
});

t('unknown door opens nothing and never calls Shelly', () => {
  const n = fetches.length;
  assert.strictEqual(ctx.unlockDoor('ada@example.com', 'ABCDE', '', '', 'back').ok, false);
  assert.strictEqual(fetches.length, n);
});

t('a hostile Shelly Server value cannot redirect the key', () => {
  for (const bad of ['evil.com/x?', 'evil.com#', 'a b', 'x.evil.com']) {
    assert.strictEqual(ctx.shellyServer_(bad), '', bad);
  }
  assert.strictEqual(ctx.shellyServer_('https://shelly-103-eu.shelly.cloud/'), 'shelly-103-eu');
  sheets.Doors.rows[1][2] = 'evil.com/steal?'; cache.delete('doors_index_v1');
  post(ctx, { action: 'upsert', members: [{ email: 'carol@example.com', code: 'CAROL', name: 'Carol' }] });
  const n = fetches.length;
  const res = ctx.unlockDoor('carol@example.com', 'CAROL', '', '', 'side');
  assert.strictEqual(res.ok, false); assert.strictEqual(fetches.length, n);
  sheets.Doors.rows[1][2] = 'shelly-103-eu'; cache.delete('doors_index_v1');
});

t('nearby rule: denies far away and missing location, allows at the door', () => {
  const e = env({ MAYBEOS_SECRET: SECRET, SHELLY_AUTH_KEY: 'k', REQUIRE_NEARBY_FEET: '300' });
  e.ctx.setupDoorSheet(); e.sheets.Doors.rows[1] = ['side', 'Side', 'shelly-1-us', 'd', 40.7, -74.0, true];
  post(e.ctx, { action: 'upsert', members: [{ email: 'd@x.co', code: 'DDDDD', name: 'D' }] });
  assert.strictEqual(e.ctx.unlockDoor('d@x.co', 'DDDDD', 41, -74, 'side').ok, false);
  assert.strictEqual(e.ctx.unlockDoor('d@x.co', 'DDDDD', 'denied', '', 'side').ok, false);
  assert.strictEqual(e.ctx.unlockDoor('d@x.co', 'DDDDD', 40.7003, -74.0, 'side').ok, true);
});

t('formula typed as an email is logged as text', () => {
  ctx.unlockDoor('=HYPERLINK("x")', 'ABCDE', '', '', 'side');
  assert.strictEqual(typeof sheets['Access Log'].rows.at(-1)[1], 'string');
});

t('Shelly failure is reported, not granted; key never logged', () => {
  ctx.__shellyStatus = 401;
  post(ctx, { action: 'upsert', members: [{ email: 'erin@example.com', code: 'ERINN', name: 'Erin' }] });
  const res = ctx.unlockDoor('erin@example.com', 'ERINN', '', '', 'side');
  assert.strictEqual(res.ok, false);
  assert.ok(!JSON.stringify(sheets['Access Log'].rows).includes('shelly-key'));
  ctx.__shellyStatus = 200;
});

// ── The co-op's branding on the door page (Charley, 2026-09-16) ──────────
{
  // Objects made inside the script's own context carry its prototypes, so
  // they are compared by their contents.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const ORG = 'https://maybeos.org/api/orgs/by-slug/riverside';
  const brandEnv = (body, props = {}) => {
    const e = env({ MAYBEOS_ORG_SLUG: 'riverside', SHELLY_AUTH_KEY: 'k', ...props });
    e.ctx.__http = { [ORG]: body };
    return e;
  };
  const org = (over = {}) =>
    ({ status: 200, body: JSON.stringify({ name: 'Riverside', logoUrl: 'https://cdn.example/logo.jpg', brandColor: '#afd2e9', ...over }) });

  t('dresses the door in the co-op’s name, logo and colour', () => {
    const e = brandEnv(org());
    assert.deepStrictEqual(plain(e.ctx.brand_()), {
      name: 'Riverside',
      logoUrl: 'https://cdn.example/logo.jpg',
      accent: '#afd2e9',
      // Dark text, because that blue is pale — white on it is unreadable.
      accentInk: '#211c16',
    });
    assert.strictEqual(e.fetches.at(-1).url, ORG);
  });

  t('puts white on a dark colour and dark on a pale one', () => {
    assert.strictEqual(brandEnv(org({ brandColor: '#1b3a2f' })).ctx.brand_().accentInk, '#ffffff');
    assert.strictEqual(brandEnv(org({ brandColor: '#f7e7a1' })).ctx.brand_().accentInk, '#211c16');
  });

  t('refuses a colour or logo that is not one', () => {
    // Both are written straight into CSS and HTML on the page.
    const bad = brandEnv(org({ brandColor: 'red; } body { display:none } .x {', logoUrl: 'javascript:alert(1)' })).ctx.brand_();
    assert.strictEqual(bad.accent, '#211c16');
    assert.strictEqual(bad.logoUrl, '');
    const quoted = brandEnv(org({ logoUrl: 'https://cdn.example/a.jpg" onerror="alert(1)' })).ctx.brand_();
    assert.strictEqual(quoted.logoUrl, '');
  });

  t('leaves the page plain when MaybeOS cannot be reached', () => {
    for (const reply of [{ status: 500, body: '' }, { status: 200, body: 'not json' }, new Error('network down')]) {
      const brand = plain(brandEnv(reply).ctx.brand_());
      assert.deepStrictEqual(brand, { name: '', logoUrl: '', accent: '#211c16', accentInk: '#ffffff' });
    }
  });

  t('asks MaybeOS once, then remembers for six hours', () => {
    const e = brandEnv(org());
    e.ctx.brand_();
    const asked = e.fetches.length;
    e.ctx.brand_();
    assert.strictEqual(e.fetches.length, asked);
  });

  t('does not call out at all when no co-op is named', () => {
    const e = env({ SHELLY_AUTH_KEY: 'k' });
    assert.strictEqual(e.ctx.brand_().name, '');
    assert.strictEqual(e.fetches.length, 0);
  });

  t('refuses a slug or MaybeOS address that could point somewhere else', () => {
    const e = env({ MAYBEOS_ORG_SLUG: '../../evil', SHELLY_AUTH_KEY: 'k' });
    assert.strictEqual(e.ctx.brand_().name, '');
    const f = env({ MAYBEOS_ORG_SLUG: 'riverside', MAYBEOS_URL: 'http://evil.example.com', SHELLY_AUTH_KEY: 'k' });
    assert.strictEqual(f.ctx.brand_().name, '');
    assert.strictEqual(e.fetches.length + f.fetches.length, 0);
  });
}

console.log(`\n${passed} passed`);
