/**
 * GLBC calendar membership endpoint.
 *
 * Bound to (or pointed at) the Calendar Permissions spreadsheet, deployed as a
 * web app that runs as the church account. The website is static files on
 * GitHub Pages and cannot hold a service account key, so this is the only
 * thing that may write to the sheet.
 *
 * Its real job is refusing things. A browser form can be edited by anyone who
 * opens the developer tools, so every rule that matters is enforced here:
 *
 *   - Only PUBLIC ministries can be self-selected. Nobody adds themselves to
 *     youth-leaders or worship, no matter what the browser sends.
 *   - The allowed list is read from the site's own events.json rather than
 *     hardcoded, so it cannot drift out of step with the job's config.
 *   - Tokens are generated here, never accepted from the caller.
 *   - Private ministry columns are never written, in either direction, so a
 *     leader's decision cannot be undone by somebody using the website.
 *
 * Actions, all POST with a JSON body:
 *   (none) or "signup"  name, email, groups        -> new person, or update by email
 *   "load"              token                      -> that person's name and groups
 *   "save"              token, groups              -> change their public groups
 *   "rotate"            token                      -> issue a new link, killing the old
 *
 * Deployment steps are in docs/SIGNUP.md.
 */

/**
 * The deployment number this file is meant to become.
 *
 * Apps Script serves the DEPLOYED version, not the saved one, and the editor
 * gives no hint which is live. Without a marker, a deploy that silently did
 * not take looks identical to one that did. Open the /exec URL and read the
 * version back.
 *
 * Bump this ONLY when the file is handed over to be deployed, never on an
 * edit in between. Bumping per edit ran this number ahead of Google's own
 * deployment counter, which left two numbers that look like the same thing
 * and disagree, and the whole point of the marker is telling at a glance
 * whether a deploy took.
 */
var VERSION = 11;

var SITE = 'https://calendars.greaterlifebaptistchurch.com';
var EVENTS_JSON = SITE + '/events.json';
var FEED_BASE = SITE + '/f/';
// A different host from the site on purpose: merged feeds are assembled on
// request by the Cloudflare Worker in worker/, because pre-building every
// combination is 2^n files and runs out at about eight ministries.
var COMBO_BASE = 'https://calendar.greaterlifebaptist.workers.dev/c/';
var TAB = 'People';

/**
 * Fallback spreadsheet id, for a script that is not bound to the sheet.
 *
 * Prefer the SPREADSHEET_ID **script property** over this. Anything written
 * here is wiped every time this file is pasted over, which is a trap: the
 * script keeps working until the moment somebody updates it, then silently
 * cannot find the sheet. A script property survives every paste.
 *
 * Project Settings > Script Properties > Add script property:
 *   SPREADSHEET_ID = the long part of the sheet URL between /d/ and /edit
 */
var SPREADSHEET_ID = '';

/** Token length in bytes. Matches job/src/sheet.ts. */
var TOKEN_BYTES = 16;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Where the sheet id came from, for the health check. */
function sheetSource_() {
  var fromProperty = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  if (fromProperty && String(fromProperty).trim()) return 'script property';
  if (SPREADSHEET_ID) return 'the file';
  return 'bound spreadsheet';
}

/**
 * Works whether this script is bound to the sheet or standalone.
 *
 * The script property wins, because it is the only one of the three that
 * survives pasting a new version of this file over the old one.
 */
function spreadsheetId_() {
  var fromProperty = PropertiesService.getScriptProperties()
    .getProperty('SPREADSHEET_ID');
  if (fromProperty && String(fromProperty).trim()) return String(fromProperty).trim();
  if (SPREADSHEET_ID) return SPREADSHEET_ID;
  return '';
}

function spreadsheet_() {
  var id = spreadsheetId_();
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'This script is not attached to a spreadsheet, and no SPREADSHEET_ID is ' +
      'set. Add it under Project Settings > Script Properties.'
    );
  }
  return active;
}

function sheet_() {
  var sheet = spreadsheet_().getSheetByName(TAB);
  if (!sheet) throw new Error('No "' + TAB + '" tab in this spreadsheet.');
  return sheet;
}

function headers_(sheet) {
  var width = sheet.getLastColumn();
  var row = sheet.getRange(1, 1, 1, width).getValues()[0];
  return row.map(function (h) { return String(h || '').trim(); });
}

function columnIndex_(headers, name) {
  var target = String(name).toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * The ministries a person may choose for themselves.
 *
 * events.json only ever lists public ministries, because the job builds it
 * that way, so using it as the allow-list means a private ministry can never
 * become selectable by mistake. If it cannot be fetched we fail closed.
 */
function publicMinistries_() {
  var res = UrlFetchApp.fetch(EVENTS_JSON, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Could not read the published calendar list.');
  }
  var data = JSON.parse(res.getContentText());
  var ids = {};
  (data.ministries || []).forEach(function (m) {
    if (m && m.id) ids[String(m.id)] = m.name || m.id;
  });
  return ids;
}

// ---------------------------------------------------------------------------
// Which calendar address to hand somebody
// ---------------------------------------------------------------------------
//
// A personal feed does not exist until the job has written it and Pages has
// deployed it, a minute or two after signing up. For that minute the person's
// own link returns a 404 page, and a calendar app handed a 404 page says
// "validation failed", which reads as broken rather than as not-yet. That
// lands on the first thing a new person ever does, standing in the foyer
// having just scanned a QR code, and it is where adoption is lost.
//
// So a selection of public ministries gets a PRE-BUILT combination feed
// instead. The job builds every combination in advance, so the URL already
// exists before anybody asks for it and the calendar adds immediately.
//
// Nothing in a public combination needs hiding: every event in it is already
// on the website. Two people who tick the same boxes share one URL, which is
// fine and saves building the same file twice.
//
// Anyone in a private ministry still gets their token feed. That URL carries
// something not otherwise published, so it has to stay unguessable and
// revocable, and those people are set up by a leader rather than at a QR code.

/**
 * The URL-safe name for a set of ministries: sorted, joined with "~".
 *
 * Not "-": an id may contain a hyphen, and youth-leaders does. That one is
 * private today, so a hyphen separator worked by luck; the day it went public
 * every saved URL would have turned ambiguous at once.
 *
 * combo.ts in the job builds this same slug. The two must agree exactly or
 * somebody is handed a URL that was never built, so it is kept trivial and
 * a test asserts no public ministry id contains a hyphen.
 */
function comboSlug_(ids) {
  var seen = {}, out = [];
  (ids || []).forEach(function (id) {
    var key = String(id).toLowerCase();
    if (!seen[key]) { seen[key] = true; out.push(key); }
  });
  return out.sort().join('~');
}

/**
 * Public and private ministry ids, from ministries.json.
 *
 * Deliberately NOT from events.json, which lists only ministries with
 * something coming up. Using that would drop a quiet ministry out of somebody's
 * groups and silently change their calendar address when nothing was
 * scheduled for a while.
 */
function ministrySplit_() {
  var pub = {}, priv = {};
  allMinistries_().forEach(function (m) {
    if (!m || !m.id) return;
    if (m.visibility === 'public') {
      // A ministry with no calendar behind it has no combination file either.
      if (m.calendarId) pub[m.id] = true;
    } else {
      priv[m.id] = true;
    }
  });
  return { pub: pub, priv: priv };
}

function feedUrlFor_(token, headers, values) {
  var split;
  try {
    split = ministrySplit_();
  } catch (err) {
    // If the site cannot be read, fall back to the address that always works.
    return FEED_BASE + token + '.ics';
  }

  var picked = [];
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').toLowerCase();
    if (!String(values[i] || '').trim()) continue;
    if (split.priv[key]) return FEED_BASE + token + '.ics';
    if (split.pub[key]) picked.push(key);
  }

  // Nothing ticked has no combination file, so the token feed carries it: the
  // job writes that as a valid empty calendar rather than leaving a 404.
  if (!picked.length) return FEED_BASE + token + '.ics';
  return COMBO_BASE + comboSlug_(picked) + '.ics';
}

function token_() {
  var uuid = Utilities.getUuid().replace(/-/g, '');
  var noise = '';
  for (var i = 0; i < TOKEN_BYTES; i++) noise += String(Math.random());
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    uuid + noise + String(Date.now())
  );
  return digest
    .slice(0, TOKEN_BYTES)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

/** Tokens become filenames and URLs. Anything else is not worth looking up. */
function validToken_(token) {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(String(token || ''));
}

function findByToken_(sheet, headers, token) {
  var tokenCol = columnIndex_(headers, 'token');
  if (tokenCol === -1) throw new Error('The People tab has no "token" column.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var r = 0; r < rows.length; r++) {
    if (String(rows[r][tokenCol] || '').trim() === token) {
      return { row: r + 2, values: rows[r] };
    }
  }
  return null;
}

/** Which public ministries this row currently has ticked. */
function groupsOf_(headers, values, allowed) {
  var out = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i].toLowerCase();
    if (!allowed.hasOwnProperty(key)) continue;
    if (String(values[i] || '').trim()) out.push(key);
  }
  return out;
}

/**
 * Write only the public ministry columns.
 *
 * Cell by cell rather than a whole row, so private columns and anything else a
 * leader has added are left exactly as they were.
 */
function writeGroups_(sheet, headers, row, groups, allowed) {
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i].toLowerCase();
    if (!allowed.hasOwnProperty(key)) continue;
    sheet.getRange(row, i + 1).setValue(groups.indexOf(key) !== -1 ? 'x' : '');
  }
}

function cleanGroups_(wanted, allowed) {
  var groups = [];
  for (var i = 0; i < wanted.length; i++) {
    var g = String(wanted[i]);
    // Silently dropping a rejected group would hand somebody a feed missing
    // what they asked for. Refuse the whole request instead.
    if (!allowed.hasOwnProperty(g)) return null;
    if (groups.indexOf(g) === -1) groups.push(g);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

function doGet() {
  // Confirms the deployment is alive AND that it can see the sheet, since a
  // standalone script with no SPREADSHEET_ID would otherwise look healthy
  // until the first real person tried to sign up.
  var sheetOk = false;
  var detail = '';
  try {
    sheetOk = sheet_().getLastColumn() > 0;
  } catch (err) {
    detail = String(err && err.message ? err.message : err);
  }

  // Calendar access is a separate grant from sheet access and fails
  // separately. Reporting it here means a missing scope shows up now rather
  // than as a 403 the first time somebody tries to save an event.
  var calendarOk = false;
  try {
    calendarService_().CalendarList.list({ maxResults: 1 });
    calendarOk = true;
  } catch (err) {
    if (!detail) detail = String(err && err.message ? err.message : err);
  }
  return json_({
    ok: true,
    service: 'glbc-signup',
    version: VERSION,
    actions: [
      'signup', 'load', 'save', 'rotate',
      'admin.hello', 'admin.list', 'admin.save', 'admin.delete',
      'share',
      'admin.people', 'admin.setgroups'
    ],
    adminReady: !!adminPasscode_(),
    calendar: calendarOk,
    sheetFrom: sheetSource_(),
    sheet: sheetOk,
    detail: detail
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Two people submitting at once must not write to the same row.
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'Busy, please try again.' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'Empty request.' });
    }
    var body = JSON.parse(e.postData.contents);
    var action = String(body.action || 'signup').toLowerCase();

    if (action === 'signup') return handleSignup_(body);
    if (action === 'load') return handleLoad_(body);
    if (action === 'save') return handleSave_(body);
    if (action === 'rotate') return handleRotate_(body);
    if (action === 'share')  return handleShare_(body);
    if (action === 'admin.hello')  return handleAdminHello_(body);
    if (action === 'admin.list')   return handleAdminList_(body);
    if (action === 'admin.save')   return handleAdminSave_(body);
    if (action === 'admin.delete') return handleAdminDelete_(body);
    if (action === 'admin.people')    return handleAdminPeople_(body);
    if (action === 'admin.setgroups') return handleAdminSetGroups_(body);
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function handleSignup_(body) {
  var name = String(body.name || '').trim();
  var email = String(body.email || '').trim();
  var wanted = Array.isArray(body.groups) ? body.groups : [];

  if (!name) return json_({ ok: false, error: 'Please enter your name.' });
  if (name.length > 80) return json_({ ok: false, error: 'That name is too long.' });
  if (email && email.length > 120) return json_({ ok: false, error: 'That email is too long.' });
  if (email && email.indexOf('@') === -1) {
    return json_({ ok: false, error: 'That email address does not look right.' });
  }
  if (!wanted.length) return json_({ ok: false, error: 'Pick at least one calendar.' });

  var allowed = publicMinistries_();
  var groups = cleanGroups_(wanted, allowed);
  if (!groups) return json_({ ok: false, error: 'That calendar is not available to sign up for.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var tokenCol = columnIndex_(headers, 'token');
  if (tokenCol === -1) throw new Error('The People tab has no "token" column.');

  var emailCol = columnIndex_(headers, 'email');
  var lastRow = sheet.getLastRow();
  var existingRow = -1;
  var existingToken = '';

  // Signing up twice with the same address updates the existing row rather
  // than issuing a second calendar, which would leave a stale feed on their
  // phone that nobody can revoke because nobody knows it exists.
  if (email && emailCol !== -1 && lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < rows.length; r++) {
      var candidate = String(rows[r][emailCol] || '').trim().toLowerCase();
      if (candidate && candidate === email.toLowerCase()) {
        existingRow = r + 2;
        existingToken = String(rows[r][tokenCol] || '').trim();
        break;
      }
    }
  }

  var token = existingToken || token_();
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');

  if (existingRow !== -1) {
    var nameCol = columnIndex_(headers, 'name');
    if (nameCol !== -1) sheet.getRange(existingRow, nameCol + 1).setValue(name);
    writeGroups_(sheet, headers, existingRow, groups, allowed);
  } else {
    var values = headers.map(function (h) {
      var key = h.toLowerCase();
      if (key === 'name') return name;
      if (key === 'email') return email;
      if (key === 'token') return token;
      if (key === 'created') return today;
      if (!allowed.hasOwnProperty(key)) return '';
      return groups.indexOf(key) !== -1 ? 'x' : '';
    });
    sheet.appendRow(values);
  }

  // Read the row back rather than trusting what we meant to write, so the
  // address reflects private columns a leader set that signup never touches.
  var finalRow = existingRow !== -1 ? existingRow : sheet.getLastRow();
  var finalValues = sheet.getRange(finalRow, 1, 1, headers.length).getValues()[0];

  return json_({
    ok: true,
    token: token,
    feedUrl: feedUrlFor_(token, headers, finalValues),
    groups: groups,
    updated: existingRow !== -1,
    rebuild: requestRebuild_('signup')
  });
}

function handleLoad_(body) {
  var token = String(body.token || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'That link does not look right.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var allowed = publicMinistries_();
  var found = findByToken_(sheet, headers, token);
  if (!found) {
    return json_({ ok: false, error: 'We could not find that link. It may have been replaced.' });
  }

  var nameCol = columnIndex_(headers, 'name');
  // Deliberately does not return the email address. The page has no use for
  // it, and a token is a link somebody might paste around.
  return json_({
    ok: true,
    name: nameCol === -1 ? '' : String(found.values[nameCol] || '').trim(),
    groups: groupsOf_(headers, found.values, allowed),
    feedUrl: feedUrlFor_(token, headers, found.values)
  });
}

function handleSave_(body) {
  var token = String(body.token || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'That link does not look right.' });

  var wanted = Array.isArray(body.groups) ? body.groups : [];
  var allowed = publicMinistries_();
  var groups = cleanGroups_(wanted, allowed);
  if (!groups) return json_({ ok: false, error: 'That calendar is not available to sign up for.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) {
    return json_({ ok: false, error: 'We could not find that link. It may have been replaced.' });
  }

  writeGroups_(sheet, headers, found.row, groups, allowed);
  var afterSave = sheet.getRange(found.row, 1, 1, headers.length).getValues()[0];

  // If they took the Google route, their access has to follow their choices.
  // Otherwise unticking a ministry would remove it from a feed they may not
  // even be using while leaving the real calendar on their phone.
  var emailCol = columnIndex_(headers, 'email');
  var email = emailCol === -1 ? '' : String(found.values[emailCol] || '').trim();
  var reshared = null;
  if (email && isSharedWith_(email)) {
    var all = allMinistryIds_();
    reshared = syncCalendarSharing_(email, groupsOf_(headers, afterSave, all));
  }

  return json_({
    ok: true, groups: groups, feedUrl: feedUrlFor_(token, headers, afterSave),
    reshared: reshared,
    rebuild: requestRebuild_('preferences')
  });
}

/**
 * Issue a new link and abandon the old one.
 *
 * This is what makes a leaked link recoverable. The previous feed stops
 * existing on the next sync, so anyone holding it gets nothing.
 */
function handleRotate_(body) {
  var token = String(body.token || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'That link does not look right.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) {
    return json_({ ok: false, error: 'We could not find that link. It may already have been replaced.' });
  }

  var tokenCol = columnIndex_(headers, 'token');
  var fresh = token_();
  sheet.getRange(found.row, tokenCol + 1).setValue(fresh);

  return json_({
    ok: true, token: fresh, feedUrl: feedUrlFor_(fresh, headers, found.values),
    rebuild: requestRebuild_('rotate')
  });
}

// ---------------------------------------------------------------------------
// Admin: writing events to the church calendars
// ---------------------------------------------------------------------------
//
// Gated by a passcode held in Script Properties, never in the page. This is
// deliberately not real authentication, and CLAUDE.md says so: it is a shared
// secret protecting a form that can only touch church calendars. Do not extend
// it to anything genuinely sensitive without proper sign-in first.
//
// Set the passcode once: Project Settings > Script Properties >
//   ADMIN_PASSCODE = something long
//
// Calendar writes go through the advanced Calendar service. See below for why
// that rather than CalendarApp or a direct REST call.

/**
 * Calendar access goes through the ADVANCED Calendar service, the global
 * `Calendar`, not the plain CalendarApp and not a hand-rolled REST call.
 *
 * CalendarApp cannot set extendedProperties, which is how the admin form
 * records the event type explicitly, so it is not enough on its own. Calling
 * the REST API directly does support them, but it needs the Calendar API
 * switched on inside the hidden Cloud project behind the script, which fails
 * with a 403 that mentions a project number nobody recognises.
 *
 * Adding the advanced service from the editor turns that API on as a side
 * effect, which is why this is the route that actually works:
 *   Editor > Services > + > Google Calendar API > Add
 */
function calendarService_() {
  if (typeof Calendar === 'undefined' || !Calendar || !Calendar.Events) {
    throw new Error(
      'The Google Calendar API service is not switched on for this script. ' +
      'In the Apps Script editor open Services, press +, choose Google ' +
      'Calendar API and press Add, then deploy a new version.'
    );
  }
  return Calendar;
}

function adminPasscode_() {
  return String(PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE') || '');
}

var FAIL_KEY = 'admin_fails';
var FAIL_LIMIT = 10;
var FAIL_WINDOW = 900; // seconds

/**
 * Passcode check, with a lockout after repeated failures.
 *
 * The admin page is linked from the public calendar, so this endpoint will be
 * poked at. The lockout is less about guessing, which a long passcode already
 * makes hopeless, than about the deliberate delay below: without a cap, a bot
 * hammering wrong passcodes would burn the script's daily execution quota and
 * take signup down for everybody.
 *
 * The counter is script-wide rather than per-caller, because Apps Script
 * cannot see who is calling. So a determined attacker can lock the admins out
 * for fifteen minutes. That is a far better outcome than the alternative, and
 * signup and preferences are untouched either way: nothing but the admin
 * actions ever calls this.
 */
function checkPasscode_(given) {
  var want = adminPasscode_();
  if (!want) {
    return 'No passcode is set. Add ADMIN_PASSCODE in Project Settings > Script Properties.';
  }

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get(FAIL_KEY) || 0);
  if (fails >= FAIL_LIMIT) {
    return 'Too many wrong attempts. Try again in a few minutes.';
  }

  var got = String(given || '');
  // Compare every character regardless, so the time taken says nothing about
  // how much of the passcode was right.
  var same = got.length === want.length;
  var n = Math.max(got.length, want.length);
  for (var i = 0; i < n; i++) {
    if (got.charAt(i) !== want.charAt(i)) same = false;
  }

  if (!same) {
    cache.put(FAIL_KEY, String(fails + 1), FAIL_WINDOW);
    Utilities.sleep(1200); // slow down anyone working through guesses
    return 'That passcode is not right.';
  }

  cache.remove(FAIL_KEY);
  return null;
}

/** All ministries, private included: an admin may schedule for any of them. */
function allMinistries_() {
  var res = UrlFetchApp.fetch(SITE + '/ministries.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Could not read the ministry list from the site.');
  }
  return JSON.parse(res.getContentText()).ministries || [];
}

function findMinistry_(id) {
  var list = allMinistries_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/** Rebuild the description from the notes plus the optional parsed fields. */
function buildDescription_(ev) {
  var parts = [];
  if (ev.notes) parts.push(String(ev.notes).trim());
  var tail = [];
  if (ev.cost) tail.push('cost: ' + String(ev.cost).trim());
  if (ev.contact) tail.push('contact: ' + String(ev.contact).trim());
  if (ev.link) tail.push('link: ' + String(ev.link).trim());
  if (tail.length) parts.push(tail.join('\n'));
  return parts.join('\n\n');
}

var VALID_TYPES = { deadline: 1, trip: 1, routine: 1, event: 1 };

/**
 * Turn the form into a Calendar API event resource.
 *
 * The type and pinned flag go into extendedProperties, which is the explicit
 * path the classifier honours above everything else. That is the whole point
 * of the form: nobody has to phrase a title a particular way.
 */
function toResource_(ev) {
  var title = String(ev.title || '').trim();
  if (!title) throw new Error('Give the event a title.');
  if (title.length > 200) throw new Error('That title is too long.');

  var type = String(ev.type || 'event').toLowerCase();
  if (!VALID_TYPES[type]) throw new Error('Unknown event type.');

  var res = {
    summary: title,
    description: buildDescription_(ev),
    location: String(ev.location || '').trim(),
    extendedProperties: {
      shared: {
        glbcType: type,
        glbcPinned: ev.pinned ? 'true' : 'false'
      }
    }
  };

  if (ev.allDay) {
    if (!ev.startDate) throw new Error('Give the event a date.');
    // Google's all-day end is exclusive, so a one-day event ends the next day.
    var endDate = ev.endDate || ev.startDate;
    var d = new Date(endDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    res.start = { date: ev.startDate };
    res.end = { date: Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd') };
  } else {
    if (!ev.startDate || !ev.startTime) throw new Error('Give the event a date and a start time.');
    var startIso = ev.startDate + 'T' + ev.startTime + ':00';
    var endIso = (ev.endDate || ev.startDate) + 'T' + (ev.endTime || ev.startTime) + ':00';
    if (new Date(endIso) < new Date(startIso)) throw new Error('The end is before the start.');
    res.start = { dateTime: startIso, timeZone: 'America/New_York' };
    res.end = { dateTime: endIso, timeZone: 'America/New_York' };
  }

  if (ev.rrule) {
    var rule = String(ev.rrule).trim().toUpperCase();
    if (rule.indexOf('RRULE:') !== 0) rule = 'RRULE:' + rule;
    if (!/^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.test(rule)) {
      throw new Error('That repeat rule does not look right.');
    }
    res.recurrence = [rule];
  }

  return res;
}

function handleAdminSave_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });

  var m = findMinistry_(String(body.ministry || ''));
  if (!m) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!m.calendarId) return json_({ ok: false, error: 'That ministry has no calendar set up.' });
  var resource = toResource_(body.event || {});
  var cal = calendarService_();
  var saved = body.id
    ? cal.Events.update(resource, m.calendarId, body.id)
    : cal.Events.insert(resource, m.calendarId);

  return json_({
    ok: true,
    id: saved.id,
    ministry: m.id,
    title: saved.summary,
    updated: !!body.id
  });
}

function handleAdminList_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });

  var m = findMinistry_(String(body.ministry || ''));
  if (!m) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!m.calendarId) return json_({ ok: false, error: 'That ministry has no calendar set up.' });

  // Unexpanded, so a series shows as one editable thing rather than every
  // occurrence. Editing a single occurrence of a series is a job for Google
  // Calendar; this form deals in the series itself.
  // A bounded window, or a calendar with a long-running weekly series would
  // hand back a list nobody can scan. Last week onward, a year ahead.
  var data = calendarService_().Events.list(m.calendarId, {
    singleEvents: false,
    maxResults: 250,
    showDeleted: false,
    timeMin: new Date(Date.now() - 7 * 86400000).toISOString(),
    timeMax: new Date(Date.now() + 365 * 86400000).toISOString()
  });

  var items = (data.items || []).filter(function (e) {
    // A one-off change to a single occurrence comes back as its own entry.
    // Showing it would imply this form can edit one occurrence, which it
    // deliberately cannot: that is a job for Google Calendar.
    return !e.recurringEventId;
  }).map(function (e) {
    var shared = (e.extendedProperties && e.extendedProperties.shared) || {};
    return {
      id: e.id,
      title: e.summary || '(no title)',
      start: (e.start && (e.start.dateTime || e.start.date)) || '',
      end: (e.end && (e.end.dateTime || e.end.date)) || '',
      allDay: !!(e.start && e.start.date),
      location: e.location || '',
      description: e.description || '',
      type: shared.glbcType || '',
      pinned: shared.glbcPinned === 'true',
      rrule: (e.recurrence || []).filter(function (r) { return r.indexOf('RRULE') === 0; })[0] || ''
    };
  }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

  return json_({ ok: true, ministry: m.id, events: items });
}

function handleAdminDelete_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });

  var m = findMinistry_(String(body.ministry || ''));
  if (!m || !m.calendarId) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!body.id) return json_({ ok: false, error: 'Nothing to delete.' });

  calendarService_().Events.remove(m.calendarId, body.id);
  return json_({ ok: true, deleted: body.id });
}

/** Confirms a passcode and hands back the calendars that can be written to. */
function handleAdminHello_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });
  var list = allMinistries_().filter(function (m) { return !!m.calendarId; });
  return json_({
    ok: true,
    ministries: list.map(function (m) {
      return {
        id: m.id, name: m.name, visibility: m.visibility,
        color: m.color, contact: m.contact || ''
      };
    })
  });
}

// ---------------------------------------------------------------------------
// Admin: who receives which calendars
// ---------------------------------------------------------------------------
//
// The signup page can only ever grant PUBLIC ministries. Putting somebody into
// youth-leaders or worship is a leader's decision, and until now the only way
// to make it was editing a cell in the spreadsheet.
//
// These two actions move that into the admin form. They are gated by the same
// shared passcode, which means anyone who can add somebody to Youth Leaders can
// also add them to Worship. That is a deliberate simplification while only two
// or three trusted people hold the passcode, and it is the thing to revisit
// before a pastor's calendar exists. See docs/ADMIN.md.
//
// A person is addressed by their token. It is never shown in the admin page,
// but it does reach that browser, so a passcode holder could read one from the
// page source. That grants nothing they do not already have: the passcode
// already lets them list private calendar contents directly.

/** Every ministry id, public and private, as an allow-list for writes. */
function allMinistryIds_() {
  var ids = {};
  allMinistries_().forEach(function (m) { ids[m.id] = m.name || m.id; });
  return ids;
}

function handleAdminPeople_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var all = allMinistryIds_();
  var tokenCol = columnIndex_(headers, 'token');
  var nameCol = columnIndex_(headers, 'name');
  var emailCol = columnIndex_(headers, 'email');
  if (tokenCol === -1) throw new Error('The People tab has no "token" column.');

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return json_({ ok: true, people: [] });

  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var people = [];

  for (var r = 0; r < rows.length; r++) {
    var token = String(rows[r][tokenCol] || '').trim();
    // A row with no token is half typed, not a subscriber.
    if (!token || !validToken_(token)) continue;
    people.push({
      handle: token,
      name: nameCol === -1 ? '' : String(rows[r][nameCol] || '').trim(),
      email: emailCol === -1 ? '' : String(rows[r][emailCol] || '').trim(),
      groups: groupsOf_(headers, rows[r], all)
    });
  }

  people.sort(function (a, b) {
    return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1;
  });
  return json_({ ok: true, people: people });
}

/**
 * Set somebody's calendars, private ones included.
 *
 * Unlike the preferences page, which may only touch public columns, an admin
 * writes every ministry column. That is the entire point of this action.
 */
function handleAdminSetGroups_(body) {
  var bad = checkPasscode_(body.passcode);
  if (bad) return json_({ ok: false, error: bad });

  var token = String(body.handle || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'Unknown person.' });

  var all = allMinistryIds_();
  var wanted = Array.isArray(body.groups) ? body.groups : [];
  var groups = cleanGroups_(wanted, all);
  if (!groups) return json_({ ok: false, error: 'That is not a calendar we know about.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) return json_({ ok: false, error: 'That person is no longer in the sheet.' });

  writeGroups_(sheet, headers, found.row, groups, all);
  return json_({ ok: true, handle: token, groups: groups });
}

// ---------------------------------------------------------------------------
// Run this by hand if calendar access is not working
// ---------------------------------------------------------------------------
//
// Pick authorizeCalendar from the dropdown at the top of the editor and press
// Run. Unlike doGet, this touches CalendarApp directly, so Apps Script cannot
// decide the calendar permission is unnecessary. If the permission is missing
// the consent screen appears; if it is already granted the log says so.
//
// Then look at the execution log for the two lines it prints.

function authorizeCalendar() {
  var owned = CalendarApp.getAllOwnedCalendars();
  Logger.log('CalendarApp can see ' + owned.length + ' calendars this account owns.');

  try {
    var list = calendarService_().CalendarList.list({ maxResults: 1 });
    Logger.log('Calendar API service: OK. Redeploy a new version now.');
  } catch (err) {
    Logger.log('Calendar API service: FAILED. ' + (err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------------------
// Ask the site to rebuild now
// ---------------------------------------------------------------------------
//
// A personal feed does not exist until the job builds it, and the job runs
// hourly. So somebody who has just signed up taps their own link and gets a
// 404, which reads as broken rather than as "not yet". Waiting up to an hour
// on the first thing a new person does is the wrong trade.
//
// This nudges GitHub Actions to run immediately. It is best effort: if it is
// not configured, or GitHub is having a bad day, signup still succeeds and the
// hourly run picks it up as before. Nothing here is allowed to fail a signup.
//
// To switch it on, add two script properties:
//   GITHUB_REPO            greaterlifebaptist/calendar
//   GITHUB_DISPATCH_TOKEN  a fine-grained token with Contents: read and write
//                          on that repository, and nothing else

function requestRebuild_(why) {
  try {
    var props = PropertiesService.getScriptProperties();
    var repo = String(props.getProperty('GITHUB_REPO') || '').trim();
    var token = String(props.getProperty('GITHUB_DISPATCH_TOKEN') || '').trim();
    if (!repo || !token) return 'not configured';

    // One rebuild per couple of minutes. A family signing up together should
    // not queue five identical runs, and this is a public endpoint.
    var cache = CacheService.getScriptCache();
    if (cache.get('rebuild_asked')) return 'already asked recently';
    cache.put('rebuild_asked', '1', 120);

    var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/dispatches', {
      method: 'post',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json'
      },
      payload: JSON.stringify({
        event_type: 'signup',
        client_payload: { reason: String(why || 'signup') }
      })
    });

    // 204 is success for this endpoint.
    return res.getResponseCode() === 204
      ? 'requested'
      : 'GitHub said ' + res.getResponseCode();
  } catch (err) {
    return 'failed: ' + (err && err.message ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Adding calendars straight to somebody's Google account
// ---------------------------------------------------------------------------
//
// No link can subscribe an Android phone to an .ics. The Google Calendar app
// simply has no "add by URL"; that lives on the website only. Telling somebody
// who just scanned a QR code at church to go home and find a computer is not a
// signup flow, it is a way to lose them.
//
// The church account owns these calendars, so it can share them directly with
// a Google account instead. That works on the phone in their hand, appears
// natively, syncs instantly, and is revocable properly rather than depending on
// an unguessable URL staying unguessed.
//
// The trade is that they get one calendar per ministry rather than one merged
// one. That also gets them a colour each, which a single merged feed can never
// do: every major calendar app colours by calendar, not by event, and ignores
// the per-event colour property in a subscribed feed.
//
// sendNotifications is false on purpose. The default emails an invitation the
// person then has to accept, which puts two extra steps between them and a
// working calendar.

/** Read access for one address on one calendar, without an email about it. */
function grantCalendar_(calendarId, email) {
  var cal = calendarService_();
  var ruleId = 'user:' + email;
  try {
    var existing = cal.Acl.get(calendarId, ruleId);
    if (existing && existing.role && existing.role !== 'none') return 'already';
  } catch (err) {
    // Not shared yet, which is the normal path.
  }
  cal.Acl.insert(
    { scope: { type: 'user', value: email }, role: 'reader' },
    calendarId,
    { sendNotifications: false }
  );
  return 'granted';
}

function revokeCalendar_(calendarId, email) {
  try {
    calendarService_().Acl.remove(calendarId, 'user:' + email);
    return 'revoked';
  } catch (err) {
    return 'was not shared';
  }
}

/**
 * Make somebody's Google access match the groups they have chosen.
 *
 * Idempotent, and it removes as well as adds, so unticking a ministry on the
 * preferences page takes their access away rather than only hiding it from a
 * feed they may already have on their phone.
 */
function syncCalendarSharing_(email, groups) {
  var address = String(email || '').trim();
  if (!address || address.indexOf('@') === -1) {
    return { ok: false, reason: 'no email address on file' };
  }

  var wanted = {};
  (groups || []).forEach(function (g) { wanted[g] = true; });

  var added = [], removed = [], failed = [];
  allMinistries_().forEach(function (m) {
    if (!m.calendarId) return;
    try {
      if (wanted[m.id]) {
        if (grantCalendar_(m.calendarId, address) === 'granted') added.push(m.name);
      } else {
        if (revokeCalendar_(m.calendarId, address) === 'revoked') removed.push(m.name);
      }
    } catch (err) {
      failed.push(m.name + ': ' + (err && err.message ? err.message : err));
    }
  });

  return { ok: failed.length === 0, added: added, removed: removed, failed: failed };
}

/** Has this person been given any of our calendars? */
function isSharedWith_(email) {
  var address = String(email || '').trim();
  if (!address) return false;
  var list = allMinistries_();
  for (var i = 0; i < list.length; i++) {
    if (!list[i].calendarId) continue;
    try {
      var rule = calendarService_().Acl.get(list[i].calendarId, 'user:' + address);
      if (rule && rule.role && rule.role !== 'none') return true;
    } catch (err) {
      // not shared with this one
    }
  }
  return false;
}

/**
 * Put the calendars this person has chosen into their Google account.
 *
 * Keyed on their token, so it works straight from the page they are already
 * looking at, and the email comes from their own row rather than from whatever
 * the browser sends.
 */
function handleShare_(body) {
  var token = String(body.token || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'That link does not look right.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) {
    return json_({ ok: false, error: 'We could not find that link. It may have been replaced.' });
  }

  var emailCol = columnIndex_(headers, 'email');
  var onFile = emailCol === -1 ? '' : String(found.values[emailCol] || '').trim();
  var given = String(body.email || '').trim();

  // A person may not have given an address at signup, so accept one now and
  // remember it. It is theirs either way; this is not somebody else's row.
  var address = given || onFile;
  if (!address || address.indexOf('@') === -1) {
    return json_({ ok: false, error: 'Give the Google address you use on your phone.' });
  }
  if (address.length > 120) return json_({ ok: false, error: 'That address is too long.' });

  if (given && given !== onFile && emailCol !== -1) {
    sheet.getRange(found.row, emailCol + 1).setValue(given);
  }

  var all = allMinistryIds_();
  var groups = groupsOf_(headers, found.values, all);
  var result = syncCalendarSharing_(address, groups);

  if (!result.ok && !result.added.length) {
    return json_({
      ok: false,
      error: 'Google would not share those calendars. ' + (result.failed[0] || result.reason || '')
    });
  }

  return json_({
    ok: true,
    email: address,
    added: result.added,
    removed: result.removed,
    failed: result.failed
  });
}
