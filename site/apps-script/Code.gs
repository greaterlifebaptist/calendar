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
 * Bump this whenever this file changes.
 *
 * Apps Script serves the DEPLOYED version, not the saved one, and the editor
 * gives no hint which is live. Without a marker, a deploy that silently did
 * not take looks identical to one that did. Open the /exec URL and read the
 * version back.
 */
var VERSION = 5;

var SITE = 'https://calendars.greaterlifebaptistchurch.com';
var EVENTS_JSON = SITE + '/events.json';
var FEED_BASE = SITE + '/f/';
var TAB = 'People';

/**
 * Only needed if this script is NOT bound to the spreadsheet.
 *
 * The normal route is Extensions > Apps Script from inside the sheet, which
 * binds them together and leaves this blank. If that menu will not open, a
 * standalone script at script.google.com works just as well: paste the
 * spreadsheet id from its URL in here.
 *
 *   https://docs.google.com/spreadsheets/d/THIS_PART/edit
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

/** Works whether this script is bound to the sheet or standalone. */
function spreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'This script is not attached to a spreadsheet. Set SPREADSHEET_ID at the ' +
      'top of the file to the id from the sheet URL.'
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
  return json_({
    ok: true,
    service: 'glbc-signup',
    version: VERSION,
    actions: [
      'signup', 'load', 'save', 'rotate',
      'admin.hello', 'admin.list', 'admin.save', 'admin.delete',
      'admin.people', 'admin.setgroups'
    ],
    adminReady: !!adminPasscode_(),
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

  return json_({
    ok: true,
    token: token,
    feedUrl: FEED_BASE + token + '.ics',
    groups: groups,
    updated: existingRow !== -1
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
    feedUrl: FEED_BASE + token + '.ics'
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
  return json_({ ok: true, groups: groups, feedUrl: FEED_BASE + token + '.ics' });
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

  return json_({ ok: true, token: fresh, feedUrl: FEED_BASE + fresh + '.ics' });
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
// Calendar writes go through the REST API with this script's own OAuth token.
// CalendarApp is touched in calendarExists_() purely so Apps Script grants the
// calendar scope; the REST call is what supports extendedProperties, which
// CalendarApp cannot set and which is how the admin form records the event
// type explicitly instead of relying on the title.

var CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/';

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

/** Touching CalendarApp here is what makes Apps Script grant the calendar scope. */
function calendarExists_(calendarId) {
  try {
    return !!CalendarApp.getCalendarById(calendarId);
  } catch (err) {
    return false;
  }
}

function calFetch_(url, method, payload) {
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json'
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Calendar API ' + code + ': ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
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
  if (!calendarExists_(m.calendarId)) {
    return json_({ ok: false, error: 'This account cannot reach that calendar.' });
  }

  var resource = toResource_(body.event || {});
  var base = CAL_API + encodeURIComponent(m.calendarId) + '/events';
  var saved;

  if (body.id) {
    saved = calFetch_(base + '/' + encodeURIComponent(body.id), 'put', resource);
  } else {
    saved = calFetch_(base, 'post', resource);
  }

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
  var url = CAL_API + encodeURIComponent(m.calendarId) + '/events' +
    '?singleEvents=false&maxResults=250&showDeleted=false' +
    '&timeMin=' + encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString());
  var data = calFetch_(url, 'get');

  var items = (data.items || []).map(function (e) {
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

  calFetch_(CAL_API + encodeURIComponent(m.calendarId) + '/events/' + encodeURIComponent(body.id), 'delete');
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
      return { id: m.id, name: m.name, visibility: m.visibility, color: m.color };
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
