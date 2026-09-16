/**
 * Door access — the Google Apps Script bound to a co-op's door sheet.
 *
 * Three jobs:
 *   1. Serve the door page members open on their phones (doGet + Index.html).
 *   2. Check an email and door code against the Members tab and pulse the
 *      Shelly relay (unlockDoor).
 *   3. Accept signed updates from MaybeOS, which owns the codes (doPost).
 *
 * Security rules this file is built around — each one is a mistake the first
 * version of this door made:
 *
 *   - **Every private function ends in `_`.** In Apps Script, any top-level
 *     function without a trailing underscore can be called from the browser
 *     through `google.script.run`. The original `getDoorConfig` returned the
 *     Shelly auth key to anybody who could load the door page.
 *     The only functions callable from outside are doGet, doPost, onEdit,
 *     unlockDoor and setupDoorSheet — and each is safe to call with anything.
 *
 *   - **No secret lives in the sheet.** The Shelly key and the MaybeOS secret
 *     are Script Properties. Anybody with access to a spreadsheet can read
 *     every cell in it, and the Shelly key opens the door directly through
 *     Shelly's API without passing through this script at all.
 *
 *   - **Nothing a person typed is written to a sheet as a formula.** A name or
 *     an email starting with `=` would otherwise run as a formula when an
 *     organiser opens the sheet — and `IMPORTDATA` can send cells elsewhere.
 *
 *   - **A revoked code stops working when the sheet changes**, not an hour
 *     later. Member lookups are cached for speed, and every write — from
 *     MaybeOS or by hand — clears that cache.
 */

// ── Tabs ─────────────────────────────────────────────────────────────────
const MEMBERS_TAB = 'Members';
const DOORS_TAB = 'Doors';
const LOG_TAB = 'Access Log';

/**
 * The door a link with no `?door=` opens, when the Doors tab names no default.
 * An *unknown* id in the link opens nothing.
 */
const DEFAULT_DOOR_ID = 'side';

// ── Members: columns A–E (1-based) ───────────────────────────────────────
const M_EMAIL = 1;
const M_CODE = 2;
const M_NAME = 3;
const M_REVOKED = 4;
const M_UPDATED = 5;
const MEMBER_HEADERS = ['Email', 'Door Code', 'Full Name', 'Revoked', 'Updated by MaybeOS'];

// ── Doors: columns A–G. Deliberately no key column. ──────────────────────
const D_ID = 1;
const D_NAME = 2;
const D_SERVER = 3;
const D_DEVICE = 4;
const D_LAT = 5;
const D_LON = 6;
const D_ACTIVE = 7;
/** Which door the page opens on when the link does not name one. */
const D_DEFAULT = 8;
const DOOR_HEADERS = [
  'Door ID', 'Name', 'Shelly Server', 'Shelly Device ID', 'Latitude', 'Longitude', 'Active', 'Default',
];

const LOG_HEADERS = ['Time', 'Email', 'Door', 'Result', 'Reason', 'Latitude', 'Longitude', 'Distance'];

// ── Script Properties (Project Settings → Script Properties) ─────────────
const PROP_SHELLY_KEY = 'SHELLY_AUTH_KEY';
const PROP_MAYBEOS_SECRET = 'MAYBEOS_SECRET';
/** Optional. The co-op's slug in MaybeOS, which brands the door page. */
const PROP_ORG_SLUG = 'MAYBEOS_ORG_SLUG';
/** Optional. Where MaybeOS lives, if not the hosted service. */
const PROP_MAYBEOS_URL = 'MAYBEOS_URL';
/** Optional. A number of feet; when set, the door only opens that close. */
const PROP_REQUIRE_NEARBY_FEET = 'REQUIRE_NEARBY_FEET';
/**
 * Optional. Minutes a member may hold every door unlocked for their guests
 * (Charley, 2026-09-16). Unset or 0 hides the button and refuses the call.
 *
 * **Only switch this on if the door hardware is rated to stay unlocked.** A
 * one-second pulse is what the door normally gets; a strike built for that
 * duty can overheat if it is held energised for half an hour. A maglock, or a
 * strike marked continuous duty, is fine.
 */
const PROP_HOLD_MINUTES = 'HOLD_OPEN_MINUTES';

/**
 * Five capital letters — MaybeOS's format. Codes are real words, and I and L
 * are allowed: a member always sees a code in capitals in a serif face, where
 * neither can be mistaken for a 1 (Charley, 2026-09-16).
 */
const CODE_PATTERN = /^[A-Z]{5}$/;

const BRAND_CACHE_KEY = 'brand_v1';
/** The door page is the co-op's front door, so its branding is worth a daily read. */
const BRAND_CACHE_SECONDS = 21600;
const MEMBERS_CACHE_KEY = 'members_index_v1';
const DOORS_CACHE_KEY = 'doors_index_v1';
const INDEX_CACHE_SECONDS = 600;
/** The most a hold can be, whatever the property says. */
const HOLD_MINUTES_MAX = 240;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 900;
/** How old a signed MaybeOS request may be before it is refused. */
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════
// Public entry points
// ═════════════════════════════════════════════════════════════════════════

/**
 * The door page.
 *
 * **One link for everybody** (Charley, 2026-09-16). A member should not have
 * to know which address is which door: the page opens on the door the Doors
 * tab marks as Default and, when the co-op has more than one, offers the
 * others as a choice.
 *
 * `?door=ada` still picks a door outright, which is what a QR code stuck
 * beside that door should say. An id naming no door opens nothing, rather
 * than quietly opening a different one.
 */
function doGet(e) {
  const requested = e && e.parameter ? e.parameter.door : '';
  const doors = doorList_();
  const door = requested ? findDoor_(normaliseDoorId_(requested, '')) : defaultDoor_(doors);
  const doorId = door ? door.id : normaliseDoorId_(requested, DEFAULT_DOOR_ID);

  const brand = brand_();
  const template = HtmlService.createTemplateFromFile('Index');
  template.doorId = doorId;
  template.doorName = door ? door.name : '';
  template.doorFound = Boolean(door);
  // The other doors, for the picker. One door needs no choosing.
  template.doors = doors.length > 1 ? doors.map(function (d) { return { id: d.id, name: d.name }; }) : [];
  template.holdMinutes = holdMinutes_();
  template.orgName = brand.name;
  template.logoUrl = brand.logoUrl;
  template.accent = brand.accent;
  template.accentInk = brand.accentInk;

  return template
    .evaluate()
    .setTitle([brand.name, door ? door.name : 'Door access'].filter(String).join(' · '))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called from the door page. Returns `{ ok, message }` and nothing else — the
 * message is the same for an unknown email, a wrong code and a revoked one,
 * so the page cannot be used to find out who is a member.
 */
function unlockDoor(email, code, lat, lon, doorIdRaw) {
  const doorId = normaliseDoorId_(doorIdRaw, DEFAULT_DOOR_ID);
  const location = parseLocation_(lat, lon);

  const door = findDoor_(doorId);
  if (!door) {
    log_(normaliseEmail_(email), doorId, 'Error', 'Unknown door', location, null);
    return result_(false, 'This door link is not set up. Ask an organiser for the right one.');
  }

  const who = authorise_(email, code, door.name, location);
  if (!who.ok) return who.answer;
  const cleanEmail = who.email;

  const distance = distanceFeet_(location, door);
  const requireFeet = Number(scriptProperty_(PROP_REQUIRE_NEARBY_FEET));
  if (requireFeet > 0 && door.lat !== null && door.lon !== null) {
    if (distance === null) {
      log_(cleanEmail, door.name, 'Denied', location.note || 'Location unavailable', location, null);
      return result_(false, 'Allow location access, then try again at the door.');
    }
    if (distance > requireFeet) {
      log_(cleanEmail, door.name, 'Denied', 'Too far away', location, distance);
      return result_(false, 'You need to be at the door to open it.');
    }
  }

  const opened = pulseShelly_(door);
  if (!opened.ok) {
    log_(cleanEmail, door.name, 'Error', opened.reason, location, distance);
    return result_(false, 'Your code is right, but the door did not respond. Try again, or tell an organiser.');
  }

  log_(cleanEmail, door.name, 'Granted', '', location, distance);
  return result_(true, door.name + ' is unlocked.');
}

/**
 * The co-op's name, logo and colour, so the door page looks like their front
 * door rather than a form (Charley, 2026-09-16).
 *
 * Read from MaybeOS's public page for the co-op — the same details its own
 * website shows — and cached for six hours, because a door that waits on
 * another service to open is a worse door. Anything missing or unreadable
 * simply leaves the page plain; branding is never allowed to fail an unlock.
 *
 * **Everything here is checked before it reaches the page.** These values
 * arrive over the network and are put into HTML and CSS: a colour must be a
 * hex colour, and a logo must be an `https` address with nothing in it that
 * could close an attribute.
 */
function brand_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(BRAND_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const blank = { name: '', logoUrl: '', accent: '#211c16', accentInk: '#ffffff' };
  const slug = String(scriptProperty_(PROP_ORG_SLUG) || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return blank;

  const base = String(scriptProperty_(PROP_MAYBEOS_URL) || 'https://maybeos.org').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) return blank;

  let org;
  try {
    const response = UrlFetchApp.fetch(base + '/api/orgs/by-slug/' + encodeURIComponent(slug), {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (response.getResponseCode() !== 200) return blank;
    org = JSON.parse(response.getContentText());
  } catch (err) {
    return blank;
  }

  const accent = /^#[0-9a-f]{6}$/i.test(String(org.brandColor || '')) ? String(org.brandColor) : blank.accent;
  const logo = String(org.logoUrl || '');
  const brand = {
    name: String(org.name || '').slice(0, 80),
    // https only, and no quote or angle bracket that could end the attribute.
    logoUrl: /^https:\/\/[^"'<>\s]+$/.test(logo) ? logo : '',
    accent: accent,
    accentInk: readableOn_(accent),
  };

  cache.put(BRAND_CACHE_KEY, JSON.stringify(brand), BRAND_CACHE_SECONDS);
  return brand;
}

/**
 * Black or white, whichever can be read on this colour.
 *
 * A co-op picks its colour for its own reasons, and plenty of them are pale.
 * White text on a pale blue button is a button nobody can read, so the text
 * follows the colour rather than the other way round.
 */
function readableOn_(hex) {
  const channel = function (i) {
    const v = parseInt(hex.substr(1 + i * 2, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.45 ? '#211c16' : '#ffffff';
}

/**
 * Hold every door unlocked, for a member letting guests in (Charley,
 * 2026-09-16).
 *
 * The same email and code as an unlock, because this is the larger favour:
 * one entry becomes half an hour of open doors, and the Access Log names who
 * asked for it.
 *
 * **Two things re-lock the doors**, deliberately. The relay is told to switch
 * itself back after the hold, so the door re-locks even if this script is
 * never reached again; and a one-off trigger turns the doors off at the same
 * moment, in case a device ignores a timer that long. Whichever lands first,
 * the other is harmless.
 */
function holdDoorsOpen(email, code, lat, lon) {
  const minutes = holdMinutes_();
  const location = parseLocation_(lat, lon);
  if (minutes <= 0) {
    return result_(false, 'Holding the doors open is switched off here.');
  }

  const doors = doorList_();
  if (doors.length === 0) {
    return result_(false, 'No doors are set up yet.');
  }

  const who = authorise_(email, code, 'All doors', location);
  if (!who.ok) return who.answer;

  const held = [];
  const failed = [];
  doors.forEach(function (door) {
    const result = setShelly_(door, true, minutes * 60);
    (result.ok ? held : failed).push(door.name);
  });

  if (held.length === 0) {
    log_(who.email, 'All doors', 'Error', 'Could not hold open', location, null);
    return result_(false, 'The doors did not respond. Try again, or tell an organiser.');
  }

  scheduleRelock_(minutes);
  const until = Utilities.formatDate(new Date(Date.now() + minutes * 60000), Session.getScriptTimeZone(), 'h:mm a');
  log_(who.email, held.join(', '), 'Held open', minutes + ' minutes, until ' + until, location, null);

  return result_(
    true,
    (failed.length ? held.join(', ') + ' unlocked (' + failed.join(', ') + ' did not respond)' : 'Doors unlocked') +
      ' until ' + until + '. Lock them sooner if your guests are all in.',
  );
}

/** End a hold early: the member who opened the doors closing them again. */
function lockDoorsNow(email, code, lat, lon) {
  const location = parseLocation_(lat, lon);
  const who = authorise_(email, code, 'All doors', location);
  if (!who.ok) return who.answer;

  const doors = doorList_();
  let locked = 0;
  doors.forEach(function (door) {
    if (setShelly_(door, false, null).ok) locked += 1;
  });

  cancelRelock_();
  log_(who.email, 'All doors', locked > 0 ? 'Locked' : 'Error', 'Locked by member', location, null);

  return locked > 0
    ? result_(true, 'The doors are locked again.')
    : result_(false, 'The doors did not respond. Try again, or tell an organiser.');
}

/** The scheduled half of the re-lock. Public because a trigger has to call it. */
function relockDoors() {
  doorList_().forEach(function (door) {
    setShelly_(door, false, null);
  });
  cancelRelock_();
  log_('', 'All doors', 'Locked', 'Hold ended', { lat: null, lon: null, note: '' }, null);
}

/** How long a hold may last here, or 0 when an organiser has not allowed one. */
function holdMinutes_() {
  const minutes = Math.floor(Number(scriptProperty_(PROP_HOLD_MINUTES)));
  if (!isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(minutes, HOLD_MINUTES_MAX);
}

function scheduleRelock_(minutes) {
  try {
    cancelRelock_();
    ScriptApp.newTrigger('relockDoors').timeBased().after(minutes * 60 * 1000).create();
  } catch (err) {
    // The relay was already told to switch itself back, so a trigger that
    // cannot be made costs the belt, not the braces.
    Logger.log('Could not schedule the re-lock: ' + err.message);
  }
}

function cancelRelock_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'relockDoors') ScriptApp.deleteTrigger(trigger);
    });
  } catch (err) {
    Logger.log('Could not clear the re-lock trigger: ' + err.message);
  }
}

/**
 * Is this email and code a member who may open the door right now?
 *
 * One place, so the hold and the early lock cannot drift from the unlock: the
 * same rate limit, the same refusal, and the same single message whether the
 * email is unknown, the code is wrong or the membership is revoked.
 */
function authorise_(email, code, doorLabel, location) {
  const cleanEmail = normaliseEmail_(email).slice(0, 254);
  const cleanCode = String(code == null ? '' : code).trim().toUpperCase().slice(0, 32);

  if (!cleanEmail || !cleanCode) {
    return { ok: false, answer: result_(false, 'Enter your email and your door code.') };
  }

  if (tooManyFailures_(cleanEmail)) {
    log_(cleanEmail, doorLabel, 'Denied', 'Too many attempts', location, null);
    return { ok: false, answer: result_(false, 'Too many attempts. Try again in 15 minutes.') };
  }

  const member = membersIndex_()[cleanEmail];
  const valid = Boolean(member) && !member.revoked && safeEqual_(member.code, cleanCode);

  if (!valid) {
    recordFailure_(cleanEmail);
    const reason = !member ? 'Unknown email' : member.revoked ? 'Revoked' : 'Wrong code';
    log_(cleanEmail, doorLabel, 'Denied', reason, location, null);
    return { ok: false, answer: result_(false, 'Access denied. Check your email and door code.') };
  }

  clearFailures_(cleanEmail);
  return { ok: true, email: cleanEmail, member: member };
}

/**
 * Signed updates from MaybeOS.
 *
 * Body: { timestamp, payload, signature }
 *   timestamp  milliseconds since the epoch, within five minutes of now
 *   payload    a JSON *string*: {"action":"ping"} or
 *              {"action":"upsert","members":[{email,code,name,revoked}]}
 *   signature  base64(HMAC-SHA256(MAYBEOS_SECRET, timestamp + "." + payload))
 *
 * The payload is signed as the exact string sent, never re-serialised, so
 * both sides sign identical bytes. A replayed request inside the window is
 * harmless: every write here is idempotent.
 *
 * Always answers HTTP 200 — Apps Script cannot set a status code — so the
 * caller reads `ok` from the body. It never returns a code, a name or a log.
 */
function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }

  const secret = scriptProperty_(PROP_MAYBEOS_SECRET);
  if (!secret) return json_({ ok: false, error: 'not_configured' });

  const timestamp = Number(request && request.timestamp);
  const payload = request && typeof request.payload === 'string' ? request.payload : null;
  const signature = request && typeof request.signature === 'string' ? request.signature : '';

  if (!payload || !Number.isFinite(timestamp)) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return json_({ ok: false, error: 'stale' });
  }

  const expected = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(String(timestamp) + '.' + payload, secret, Utilities.Charset.UTF_8),
  );
  if (!safeEqual_(expected, signature)) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(payload);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }

  if (body && body.action === 'ping') {
    return json_({ ok: true, action: 'ping', members: countMembers_() });
  }

  if (!body || body.action !== 'upsert' || !Array.isArray(body.members)) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (body.members.length > 1000) {
    return json_({ ok: false, error: 'too_many' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'busy' });

  try {
    const counts = upsertMembers_(body.members);
    return json_({
      ok: true,
      action: 'upsert',
      updated: counts.updated,
      added: counts.added,
      unchanged: counts.unchanged,
      rejected: counts.rejected,
    });
  } catch (err) {
    return json_({ ok: false, error: 'server_error', detail: String(err && err.message).slice(0, 200) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * A person edited the sheet: forget the cached copy so the door reads the new
 * one. Simple triggers fire for edits made by hand, not for edits a script
 * makes — doPost clears the cache itself.
 */
function onEdit(e) {
  try {
    const name = e.range.getSheet().getName();
    const cache = CacheService.getScriptCache();
    if (name === MEMBERS_TAB) cache.remove(MEMBERS_CACHE_KEY);
    if (name === DOORS_TAB) cache.remove(DOORS_CACHE_KEY);
    // An organiser editing the sheet is also how the branding gets refreshed
    // before its six hours are up.
    cache.remove(BRAND_CACHE_KEY);
  } catch (err) {
    // No real edit event — nothing to clear.
  }
}

/**
 * Run once from the editor. Creates the three tabs and their headers.
 *
 * Never deletes or overwrites anything that is already there, so running it
 * twice — or somebody calling it from a browser — changes nothing.
 */
function setupDoorSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const membersIsNew = !ss.getSheetByName(MEMBERS_TAB);
  const members = ensureTab_(ss, MEMBERS_TAB, MEMBER_HEADERS);
  const doors = ensureTab_(ss, DOORS_TAB, DOOR_HEADERS);
  const log = ensureTab_(ss, LOG_TAB, LOG_HEADERS);

  // Plain text, so Sheets never turns an email, a code or a device id into a
  // number or a formula.
  members.getRange('A:C').setNumberFormat('@');
  // Only on a new tab: turning a typed "yes" into a checkbox would hide it.
  if (membersIsNew) members.getRange('D2:D').insertCheckboxes();
  doors.getRange('A:D').setNumberFormat('@');
  log.getRange('B:E').setNumberFormat('@');

  if (members.getProtections(SpreadsheetApp.ProtectionType.RANGE).length === 0) {
    members
      .getRange('A:E')
      .protect()
      .setDescription('Written by MaybeOS. Edits here are overwritten on the next sync.')
      .setWarningOnly(true);
  }

  if (doors.getLastRow() < 2) {
    doors.getRange(2, 1, 1, DOOR_HEADERS.length).setValues([[
      DEFAULT_DOOR_ID, 'Side Door', '', '', '', '', true, true,
    ]]);
  }

  // The Default column arrived after the first sheets were made, so its
  // heading is written in if it is missing. Nothing else on the tab is
  // touched: an organiser's own columns beyond it are theirs.
  const defaultHeader = doors.getRange(1, D_DEFAULT);
  if (!String(defaultHeader.getValue() || '').trim()) {
    defaultHeader.setValue(DOOR_HEADERS[D_DEFAULT - 1]).setFontWeight('bold');
  }

  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(blank);
  }

  CacheService.getScriptCache().removeAll([MEMBERS_CACHE_KEY, DOORS_CACHE_KEY]);
  Logger.log('Door sheet is set up. Next: Script Properties, then Deploy.');
}

// ═════════════════════════════════════════════════════════════════════════
// Members
// ═════════════════════════════════════════════════════════════════════════

/** email → { code, revoked }, cached. The first row for an email wins. */
function membersIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(MEMBERS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const index = {};
  const sheet = sheet_(MEMBERS_TAB);
  if (sheet && sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, M_REVOKED).getValues();
    rows.forEach(function (row) {
      const email = normaliseEmail_(row[M_EMAIL - 1]);
      const code = String(row[M_CODE - 1] == null ? '' : row[M_CODE - 1]).trim().toUpperCase();
      if (!email || !code || Object.prototype.hasOwnProperty.call(index, email)) return;
      index[email] = { code: code, revoked: isRevoked_(row[M_REVOKED - 1]) };
    });
  }

  const serialised = JSON.stringify(index);
  // CacheService refuses values over 100KB; a co-op large enough to reach
  // that is simply read from the sheet each time.
  if (serialised.length < 90000) cache.put(MEMBERS_CACHE_KEY, serialised, INDEX_CACHE_SECONDS);
  return index;
}

/**
 * Add or update members by email. Rows MaybeOS did not send are left alone,
 * so an organiser can still add a cleaner or a contractor by hand.
 */
function upsertMembers_(members) {
  const sheet = sheet_(MEMBERS_TAB);
  if (!sheet) throw new Error('The Members tab is missing. Run setupDoorSheet.');

  const width = MEMBER_HEADERS.length;
  const lastRow = lastMemberRow_(sheet);
  const existing = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];

  const rowOf = {};
  existing.forEach(function (row, i) {
    const email = normaliseEmail_(row[M_EMAIL - 1]);
    if (email && !Object.prototype.hasOwnProperty.call(rowOf, email)) rowOf[email] = i;
  });

  const now = new Date();
  const additions = [];
  const seen = {};
  const counts = { updated: 0, added: 0, unchanged: 0, rejected: 0 };
  let changed = false;

  members.forEach(function (member) {
    const email = normaliseEmail_(member && member.email);
    const code = String((member && member.code) || '').trim().toUpperCase();
    const name = String((member && member.name) || '').trim().slice(0, 200);
    const revoked = Boolean(member) && member.revoked === true;

    if (!email || email.indexOf('@') < 1 || !CODE_PATTERN.test(code) || seen[email]) {
      counts.rejected += 1;
      return;
    }
    seen[email] = true;

    const next = [safeCell_(email), code, safeCell_(name), revoked, now];
    const at = rowOf[email];

    if (at === undefined) {
      additions.push(next);
      return;
    }

    const row = existing[at];
    const same =
      String(row[M_CODE - 1] == null ? '' : row[M_CODE - 1]).trim().toUpperCase() === code &&
      stripApostrophe_(row[M_NAME - 1]) === name &&
      isRevoked_(row[M_REVOKED - 1]) === revoked;

    if (same) {
      counts.unchanged += 1;
      return;
    }

    existing[at] = next;
    changed = true;
    counts.updated += 1;
  });

  if (changed) {
    sheet.getRange(2, 1, existing.length, width).setValues(existing);
  }

  if (additions.length > 0) {
    const start = Math.max(lastRow, 1) + 1;
    const needed = start + additions.length - 1 - sheet.getMaxRows();
    if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    sheet.getRange(start, 1, additions.length, width).setValues(additions);
    counts.added = additions.length;
  }

  if (changed || additions.length > 0) {
    CacheService.getScriptCache().remove(MEMBERS_CACHE_KEY);
  }

  return counts;
}

function countMembers_() {
  const sheet = sheet_(MEMBERS_TAB);
  return sheet ? Math.max(lastMemberRow_(sheet) - 1, 0) : 0;
}

/**
 * The last row with an email in column A. Not getLastRow(): an empty Revoked
 * checkbox holds FALSE, so Sheets counts every checkbox row as filled, and new
 * members would land below row 1000.
 */
function lastMemberRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const emails = sheet.getRange(2, M_EMAIL, last - 1, 1).getValues();
  for (let i = emails.length - 1; i >= 0; i -= 1) {
    if (String(emails[i][0] == null ? '' : emails[i][0]).trim() !== '') return i + 2;
  }
  return 1;
}

/** Checkbox TRUE, or the words people type: yes, y, true, revoked. */
function isRevoked_(value) {
  return isYes_(value) || /^revoked$/i.test(String(value == null ? '' : value).trim());
}

/** A ticked checkbox, or a typed yes. An empty cell is no. */
function isYes_(value) {
  if (value === true) return true;
  return /^(true|yes|y)$/i.test(String(value == null ? '' : value).trim());
}

// ═════════════════════════════════════════════════════════════════════════
// Doors
// ═════════════════════════════════════════════════════════════════════════

function findDoor_(doorId) {
  const index = doorsIndex_();
  return Object.prototype.hasOwnProperty.call(index, doorId) ? index[doorId] : null;
}

/** Every door that is switched on, in the order of the sheet. */
function doorList_() {
  const index = doorsIndex_();
  return Object.keys(index).map(function (id) { return index[id]; });
}

/**
 * The door a bare link opens: the one an organiser ticked Default, or the
 * first in the sheet, or nothing at all when the Doors tab is empty.
 */
function defaultDoor_(doors) {
  const list = doors || doorList_();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].isDefault) return list[i];
  }
  return list[0] || null;
}

/** door id → config, cached. Holds nothing secret: the key is not in the sheet. */
function doorsIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(DOORS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const index = {};
  const sheet = sheet_(DOORS_TAB);
  if (sheet && sheet.getLastRow() >= 2) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, DOOR_HEADERS.length)
      .getValues()
      .forEach(function (row) {
        const id = normaliseDoorId_(row[D_ID - 1], '');
        if (!id || Object.prototype.hasOwnProperty.call(index, id)) return;

        const active = row[D_ACTIVE - 1];
        if (active === false || /^(false|no|n)$/i.test(String(active == null ? '' : active).trim())) return;

        index[id] = {
          id: id,
          name: String(row[D_NAME - 1] || id).trim(),
          server: shellyServer_(row[D_SERVER - 1]),
          deviceId: String(row[D_DEVICE - 1] == null ? '' : row[D_DEVICE - 1]).trim(),
          lat: toNumber_(row[D_LAT - 1]),
          lon: toNumber_(row[D_LON - 1]),
          isDefault: isYes_(row[D_DEFAULT - 1]),
        };
      });
  }

  cache.put(DOORS_CACHE_KEY, JSON.stringify(index), INDEX_CACHE_SECONDS);
  return index;
}

/**
 * The Shelly cloud server, reduced to its bare name (`shelly-103-eu`).
 *
 * Validated because this is spliced into the URL the Shelly key is sent to.
 * Without the check, a sheet editor could set the server to `evil.com/x?` and
 * the next unlock would send the key to their server instead of Shelly's.
 */
function shellyServer_(value) {
  const server = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.shelly\.cloud$/, '');
  return /^[a-z0-9-]+$/.test(server) ? server : '';
}

/** A one-second pulse on channel 0, as the door has always been opened. */
function pulseShelly_(door) {
  return setShelly_(door, true, 1);
}

/**
 * Switch a door's relay. `seconds` is when Shelly should switch it back — one
 * second for an ordinary entry, the hold for guests, or null to leave it.
 */
function setShelly_(door, on, seconds) {
  const key = scriptProperty_(PROP_SHELLY_KEY);
  if (!key) return { ok: false, reason: 'SHELLY_AUTH_KEY is not set' };
  if (!door.server) return { ok: false, reason: 'Door has no valid Shelly Server' };
  if (!door.deviceId) return { ok: false, reason: 'Door has no Shelly Device ID' };

  const url =
    'https://' + door.server + '.shelly.cloud/v2/devices/api/set/switch?auth_key=' +
    encodeURIComponent(key);

  const payload = { id: door.deviceId, channel: 0, on: on };
  if (seconds) payload.toggle_after = seconds;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    return status === 200 ? { ok: true } : { ok: false, reason: 'Shelly answered ' + status };
  } catch (err) {
    // The error text can include the URL, and the URL includes the key, so it
    // is never written to the log.
    return { ok: false, reason: 'Could not reach Shelly' };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Attempts, location and the log
// ═════════════════════════════════════════════════════════════════════════

function tooManyFailures_(email) {
  return Number(CacheService.getScriptCache().get(failureKey_(email)) || 0) >= MAX_FAILURES;
}

function recordFailure_(email) {
  const cache = CacheService.getScriptCache();
  const key = failureKey_(email);
  cache.put(key, String(Number(cache.get(key) || 0) + 1), FAILURE_WINDOW_SECONDS);
}

function clearFailures_(email) {
  CacheService.getScriptCache().remove(failureKey_(email));
}

/** Hashed, because cache keys are capped at 250 characters and emails are not. */
function failureKey_(email) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email, Utilities.Charset.UTF_8);
  return 'fail_' + Utilities.base64EncodeWebSafe(bytes);
}

function parseLocation_(lat, lon) {
  const hasValues = lat !== null && lat !== undefined && lat !== '' && lon !== null && lon !== undefined && lon !== '';
  const la = Number(lat);
  const lo = Number(lon);
  if (hasValues && isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
    return { lat: la, lon: lo, note: '' };
  }
  return {
    lat: null,
    lon: null,
    note: String(lat).toLowerCase() === 'denied' ? 'Location denied' : 'Location unavailable',
  };
}

function distanceFeet_(location, door) {
  if (!location || location.lat === null || door.lat === null || door.lon === null) return null;
  const toRad = Math.PI / 180;
  const dLat = (door.lat - location.lat) * toRad;
  const dLon = (door.lon - location.lon) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(location.lat * toRad) * Math.cos(door.lat * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 5280;
}

/** Denials are logged too, so somebody trying codes is visible. */
function log_(email, doorName, outcome, reason, location, distanceFeet) {
  const sheet = sheet_(LOG_TAB);
  if (!sheet) return;
  sheet.appendRow([
    new Date(),
    safeCell_(email),
    safeCell_(doorName),
    outcome,
    reason,
    location && location.lat !== null ? location.lat : '',
    location && location.lon !== null ? location.lon : '',
    distanceFeet === null || distanceFeet === undefined
      ? (location && location.note) || ''
      : Math.round(distanceFeet).toLocaleString() + ' ft',
  ]);
}

// ═════════════════════════════════════════════════════════════════════════
// Small helpers
// ═════════════════════════════════════════════════════════════════════════

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function ensureTab_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function scriptProperty_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function normaliseEmail_(value) {
  return stripApostrophe_(value).trim().toLowerCase();
}

function normaliseDoorId_(value, fallback) {
  const id = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return id || fallback;
}

function toNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isFinite(n) ? n : null;
}

/** Text a person wrote, made safe to put in a cell: never a formula. */
function safeCell_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function stripApostrophe_(value) {
  const text = String(value == null ? '' : value);
  return text.charAt(0) === "'" ? text.slice(1) : text;
}

/** Compares without stopping at the first difference. */
function safeEqual_(a, b) {
  const left = String(a);
  const right = String(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function result_(ok, message) {
  return { ok: ok, message: message };
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
