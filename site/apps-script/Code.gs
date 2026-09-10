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
 * Which copy of this file is running, as a datestamp.
 *
 * Apps Script serves the DEPLOYED version, not the saved one, and the editor
 * gives no hint which is live. Without a marker, a deploy that silently did
 * not take looks identical to one that did. Open the /exec URL and read this
 * back; if it does not match the file, the deploy did not happen.
 *
 * It is deliberately NOT Google's deployment number. Trying to keep the two in
 * step failed four times: a version handed over but not deployed, or two
 * handed over between deploys, and the numbers drift — and two numbers that
 * look like the same thing and disagree are worse than no marker at all. Worse
 * still, they can collide and read as a match when nothing was deployed, which
 * is a false pass on the one question this exists to answer.
 *
 * A datestamp cannot be mistaken for a deployment number, so nobody expects it
 * to match Manage deployments, and it never collides. Bump it whenever this
 * file is handed over: the date, plus a letter if more than one goes out that
 * day.
 */
var VERSION = '2026-09-10b';

var SITE = 'https://calendars.greaterlifebaptistchurch.com';
var EVENTS_JSON = SITE + '/events.json';
// Personal feeds are served by the Worker, which passes through the file the
// job builds and stands in for it during the first hour, before it exists.
// That is what lets one address serve somebody from signup onwards.
var FEED_BASE = 'https://calendar.greaterlifebaptist.workers.dev/f/';
var TAB = 'People';

/** Who may be an event's contact. Small, leader-maintained, never public. */
var CONTACTS_TAB = 'Contacts';

/** One row per response. Append-only, and it grows. */
var RSVPS_TAB = 'RSVPs';

/**
 * Settings a leader can change that the hourly job needs to read.
 *
 * The sheet rather than a script property, because the job already has
 * authenticated access to the sheet and none at all to this script. A card is
 * generated once a month; it must not fail because an HTTP call to Apps Script
 * timed out. It is also visible and editable directly, which is a better
 * fallback than a value only this page can see.
 */
var SETTINGS_TAB = 'Settings';

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
// One address, from signup onwards, forever: their token feed.
//
// It used to depend on what they had picked. Anybody with only public groups
// was sent to a shared combination feed, because their own feed does not exist
// until the job has run and a URL that 404s for an hour is a terrible first
// experience. That worked, and cost more than it saved: the address then
// changed the moment a leader added them to a private group, and no
// subscription can follow a URL change. Their phone kept the old feed, still
// refreshing, missing exactly the events they had just been added to, with
// nothing anywhere to say so.
//
// The token was always the stable thing. The Worker now serves it from the
// first second — passing through the built file once it exists, and standing
// in with their public groups until it does — so there is no reason left to
// send anybody anywhere else.

function feedUrlFor_(token) {
  return FEED_BASE + token + '.ics';
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
      'admin.people', 'admin.setgroups', 'admin.share', 'admin.remove',
      'contacts', 'rsvp', 'admin.rsvps', 'notice', 'admin.notice', 'admin.settings',
      'card.mail', 'admin.makecard',
      'config', 'admin.leaders', 'admin.addleader', 'admin.removeleader',
      'admin.setleader'
    ],
    adminReady: !!adminPasscode_(),
    signIn: signInHealth_(),
    calendar: calendarOk,
    sheetFrom: sheetSource_(),
    sheet: sheetOk,
    detail: detail
  });
}

/**
 * Actions that only read.
 *
 * The lock below exists for one reason: two people submitting at once must not
 * write to the same row of the sheet. Reads cannot cause that, and making them
 * wait for it is what turned a slow calendar fetch into "Busy, please try
 * again" for everybody — including signup and the RSVP form, which have
 * nothing to do with whoever is browsing events in the admin page.
 *
 * Changing the ministry dropdown fetches a year of events from Google, which
 * takes seconds. Three of those in a row used to hold the whole endpoint shut
 * for most of a minute.
 *
 * A read taken while somebody else is mid-write may see the row as it was a
 * moment ago. That was always true of the health check, which has never taken
 * this lock, and it is the right trade: a slightly stale read costs a refresh,
 * a queue costs everybody the service.
 */
var READ_ONLY = {
  'config': 1, 'load': 1, 'contacts': 1, 'notice': 1,
  'admin.hello': 1, 'admin.list': 1, 'admin.people': 1,
  'admin.rsvps': 1, 'admin.leaders': 1
};

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return json_({ ok: false, error: 'Empty request.' });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'That request was not readable.' });
  }
  var action = String(body.action || 'signup').toLowerCase();

  if (READ_ONLY[action]) return route_(action, body);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({
      ok: false,
      error: 'Somebody else is saving something right now. Try that again in a moment.'
    });
  }
  try {
    return route_(action, body);
  } finally {
    lock.releaseLock();
  }
}

function route_(action, body) {
  try {
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
    if (action === 'notice')          return handleNotice_(body);
    if (action === 'admin.notice')    return handleAdminNotice_(body);
    if (action === 'admin.settings')  return handleAdminSettings_(body);
    if (action === 'card.mail')       return handleCardMail_(body);
    if (action === 'admin.makecard')  return handleAdminMakeCard_(body);
    if (action === 'contacts')        return handleContacts_(body);
    if (action === 'rsvp')            return handleRsvp_(body);
    if (action === 'admin.rsvps')     return handleAdminRsvps_(body);
    if (action === 'admin.share')     return handleAdminShare_(body);
    if (action === 'admin.remove')    return handleAdminRemove_(body);
    if (action === 'config')             return handleConfig_();
    if (action === 'admin.leaders')      return handleAdminLeaders_(body);
    if (action === 'admin.addleader')    return handleAdminAddLeader_(body);
    if (action === 'admin.removeleader') return handleAdminRemoveLeader_(body);
    if (action === 'admin.setleader')    return handleAdminSetLeader_(body);
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
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
    feedUrl: feedUrlFor_(token),
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
    feedUrl: feedUrlFor_(token)
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
    ok: true, groups: groups, feedUrl: feedUrlFor_(token),
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
    ok: true, token: fresh, feedUrl: feedUrlFor_(fresh),
    rebuild: requestRebuild_('rotate')
  });
}

// ---------------------------------------------------------------------------
// Admin: writing events to the church calendars
// ---------------------------------------------------------------------------
//
// Gated by checkAdmin_, which accepts a Google sign-in checked against the
// Leaders tab, or the old shared passcode while REQUIRE_SIGNIN is off. See
// "Who is asking" below for what each is worth.
//
// The passcode lives in Script Properties, never in the page:
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

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------
//
// Two ways in, and they are not equal.
//
// Google sign-in is the real one. The browser hands over an ID token, Google
// tells us whose it is, and that address is looked up in the Leaders tab.
// There is no secret to share, forget, or text to the wrong person; taking
// somebody's access away is deleting a row; and every action carries a name,
// so "who changed that?" has an answer.
//
// The passcode still works, because switching a whole church over on a Sunday
// afternoon with no computer in the building is how people end up locked out
// of their own calendar. It keeps working until REQUIRE_SIGNIN is set, and
// then it stops being accepted at all and a name on the list is the only way
// in. That switch is the actual upgrade; everything before it is preparation.
//
// Set up once, in Project Settings > Script Properties:
//   GOOGLE_CLIENT_ID   the OAuth client id from the church Cloud project
//   REQUIRE_SIGNIN     yes, once every leader has signed in at least once
//
// docs/ADMIN-SIGNIN.md has the click-by-click.

/** Who may work the admin page. Name, address, and whether they still may. */
var LEADERS_TAB = 'Leaders';

/** What they did. Trimmed from the top so it cannot grow without limit. */
var ADMIN_LOG_TAB = 'Admin log';
var ADMIN_LOG_MAX = 2000;

/**
 * Who this request turned out to be.
 *
 * Set by checkAdmin_ and read by the log a moment later. A global rather than
 * a return value because it would otherwise have to be threaded through
 * fourteen handlers that have no other use for it. Apps Script runs one
 * request per execution, so there is nobody else's value to collide with.
 */
var CALLER = '';

function scriptProp_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

function googleClientId_() { return scriptProp_('GOOGLE_CLIENT_ID'); }

function requireSignIn_() { return /^(yes|y|true|on|1)$/i.test(scriptProp_('REQUIRE_SIGNIN')); }

/**
 * The same address, however it happens to be spelled.
 *
 * Gmail ignores dots and anything after a plus, so spencer.welch@gmail.com,
 * spencerwelch@gmail.com and spencerwelch+church@gmail.com are one account
 * with one inbox. Google's token returns whichever spelling the account was
 * created with; somebody typing their own address into the sheet will use
 * whichever one they think of. Comparing the two literally means a sign-in
 * refused for no visible reason, which is the worst kind of refusal.
 *
 * Gmail only. Other providers may treat a dot as significant, and folding one
 * on their behalf would let one person's address stand in for another's.
 */
function normalizeEmail_(raw) {
  var email = String(raw || '').trim().toLowerCase();
  var at = email.lastIndexOf('@');
  if (at === -1) return email;
  var user = email.slice(0, at);
  var host = email.slice(at + 1);
  if (host === 'googlemail.com') host = 'gmail.com';
  if (host === 'gmail.com') {
    var plus = user.indexOf('+');
    if (plus !== -1) user = user.slice(0, plus);
    user = user.split('.').join('');
  }
  if (!user) return email;
  return user + '@' + host;
}

var LEADER_COLUMNS = ['name', 'email', 'active', 'role', 'ministries', 'added', 'notes'];

/**
 * What each level may reach.
 *
 * The page hides what a level cannot use, which is courtesy. This table is
 * what actually decides it: a browser can be edited by anyone who opens the
 * developer tools, so every rule that matters is enforced on this side.
 *
 *   admin   everything, including who else may get in
 *   staff   everything except the leaders list
 *   leader  events and RSVPs
 *   viewer  RSVPs, and nothing that changes anything
 */
var ROLES = {
  admin:  { events: true,  people: true,  notices: true,  rsvps: true, leaders: true  },
  staff:  { events: true,  people: true,  notices: true,  rsvps: true, leaders: false },
  leader: { events: true,  people: false, notices: false, rsvps: true, leaders: false },
  viewer: { events: false, people: false, notices: false, rsvps: true, leaders: false }
};

/** Who this request turned out to be, past their name. Set by checkAdmin_. */
var CALLER_ROLE = '';
var CALLER_SCOPE = null;

/**
 * A row's role, read charitably but not generously.
 *
 * Blank, misspelled, or a level that no longer exists all come out as leader.
 * That is the quiet end of the scale: a row typed in a hurry grants the least
 * rather than the most. The migration below is what keeps that rule from
 * catching the people who were already here before roles existed.
 */
function normalizeRole_(raw) {
  var role = String(raw || '').trim().toLowerCase();
  return ROLES[role] ? role : 'leader';
}

/**
 * Which ministries somebody may touch, or null for all of them.
 *
 * Written in the sheet as a list of ids — "youth, youth-leaders" — separated
 * however the person typing felt like separating them. Blank means all, and
 * so does a bare `*` for somebody who would rather say it than imply it.
 *
 * Ids, not display names. "Man Church" may be renamed one day; `mens` will
 * not, which is the whole reason the ids are locked.
 */
function parseScope_(raw) {
  var text = String(raw || '').trim();
  if (!text || text === '*') return null;
  var out = [];
  var parts = text.split(/[;,]/);
  for (var i = 0; i < parts.length; i++) {
    var id = parts[i].trim().toLowerCase();
    if (id) out.push(id);
  }
  return out.length ? out : null;
}

/**
 * The Leaders tab, with the columns this version needs.
 *
 * Roles and ministry scope arrived after the tab did, so a sheet set up an
 * hour ago is missing both columns. They are added on the way past rather
 * than by hand: there is no computer at the church, and "open the spreadsheet
 * and insert a column" is not a step that happens on a phone.
 *
 * Every row that already existed is filled in as admin. Those are the people
 * who had every power a moment ago, and quietly demoting them would put the
 * only way back in behind a page they could no longer open.
 */
function leadersSheet_() {
  var sheet = tab_(LEADERS_TAB, LEADER_COLUMNS);
  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = leaderHeaders_(sheet, width);

  var missing = [];
  for (var i = 0; i < LEADER_COLUMNS.length; i++) {
    if (headers.indexOf(LEADER_COLUMNS[i]) === -1) missing.push(LEADER_COLUMNS[i]);
  }
  if (!missing.length) return sheet;

  var at = width + 1;
  sheet.getRange(1, at, 1, missing.length).setValues([missing]);

  var rows = sheet.getLastRow() - 1;
  var roleAt = missing.indexOf('role');
  if (rows > 0 && roleAt !== -1) {
    var fill = [];
    for (var r = 0; r < rows; r++) fill.push(['admin']);
    sheet.getRange(2, at + roleAt, rows, 1).setValues(fill);
  }
  return sheet;
}

function leaderHeaders_(sheet, width) {
  return sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });
}

/**
 * The leaders list, read once per request.
 *
 * checkAdmin_ asks who the caller is, the level check asks again, and the
 * last-admin guard asks a third time — three round trips to the same handful
 * of rows, on every single action. Apps Script runs one request per execution,
 * so there is nobody else's list to hand back by mistake.
 *
 * Anything that writes to the tab clears this. There are three such places
 * and they all go through appendLeader_, setLeaderCell_ or the delete below.
 */
var LEADERS_CACHE = null;

function leaders_() {
  if (LEADERS_CACHE) return LEADERS_CACHE;
  var sheet = leadersSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];

  // Read by column name rather than position. The tab gained two columns in
  // the middle of its life and will gain more; counting from the left is how
  // a sheet quietly starts reporting one field as another.
  var width = sheet.getLastColumn();
  var headers = leaderHeaders_(sheet, width);
  var at = function (name) { return headers.indexOf(name); };
  var cell = function (row, name) {
    var i = at(name);
    return i === -1 ? '' : String(row[i] || '').trim();
  };

  var rows = sheet.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var email = cell(rows[i], 'email');
    if (!email || email.indexOf('@') === -1) continue;
    var active = cell(rows[i], 'active');
    // Blank means yes, the same as Contacts. A new row should work without
    // ceremony; switching somebody off should take a deliberate word.
    if (active && /^(no|n|off|false|0)$/i.test(active)) continue;
    out.push({
      row: i + 2,
      name: cell(rows[i], 'name'),
      email: email,
      key: normalizeEmail_(email),
      role: normalizeRole_(cell(rows[i], 'role')),
      scope: parseScope_(cell(rows[i], 'ministries')),
      notes: cell(rows[i], 'notes')
    });
  }
  LEADERS_CACHE = out;
  return out;
}

/** Write one field of one leader's row, by column name. */
function setLeaderCell_(row, name, value) {
  var sheet = leadersSheet_();
  var headers = leaderHeaders_(sheet, sheet.getLastColumn());
  var at = headers.indexOf(name);
  if (at === -1) return;
  sheet.getRange(row, at + 1).setValue(value);
  LEADERS_CACHE = null;
}

/** How many admins are left. The list must never run out of them. */
function adminCount_() {
  var list = leaders_();
  var n = 0;
  for (var i = 0; i < list.length; i++) if (list[i].role === 'admin') n++;
  return n;
}

/**
 * May the caller act on this ministry?
 *
 * A leader with no scope may touch every calendar, which is what everybody
 * had before this existed and what most of them will keep.
 */
function mayTouchMinistry_(id) {
  if (!CALLER_SCOPE) return true;
  return CALLER_SCOPE.indexOf(String(id || '').trim().toLowerCase()) !== -1;
}

function refuseMinistry_(id) {
  return json_({
    ok: false,
    error: 'Your account does not cover ' + (id || 'that calendar') + '.'
  });
}

function leaderFor_(email) {
  var key = normalizeEmail_(email);
  if (!key) return null;
  var list = leaders_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return list[i];
  }
  return null;
}

/**
 * Ask Google whose sign-in this is.
 *
 * The browser sends an ID token: a short-lived, Google-signed statement of who
 * somebody is and which application they signed in to. Checking it properly
 * means verifying an RSA signature against Google's rotating public keys, and
 * Apps Script has no primitive that verifies one, so the question goes back to
 * Google's own tokeninfo endpoint and we read the answer.
 *
 * The check that matters most is `aud`. Without it, any website could collect
 * a perfectly valid Google token from its own visitors and replay it here.
 * With it, the token has to have been minted for this application.
 *
 * Returns the person, or null for anything that does not check out. Null is
 * deliberately undifferentiated: expired, forged and meant-for-someone-else
 * all deserve the same answer, which is no.
 */
function verifyIdToken_(idToken) {
  var clientId = googleClientId_();
  if (!clientId) throw new Error('Sign-in is not set up yet: GOOGLE_CLIENT_ID is missing.');

  var cache = CacheService.getScriptCache();
  var key = 'idt_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;

  var data;
  try { data = JSON.parse(res.getContentText()); } catch (err) { return null; }

  if (String(data.aud || '') !== clientId) return null;
  if (String(data.email_verified) !== 'true') return null;
  var expires = Number(data.exp || 0) * 1000;
  if (!expires || expires <= Date.now()) return null;
  var email = String(data.email || '').trim();
  if (!email) return null;

  var who = { email: email, name: String(data.name || '').trim() };
  // Held only as long as the token itself is alive, and never more than a few
  // minutes. Opening the admin page makes several calls in a row and there is
  // no reason to ask Google about the same token every time.
  var seconds = Math.floor((expires - Date.now()) / 1000);
  cache.put(key, JSON.stringify(who), Math.max(1, Math.min(300, seconds)));
  return who;
}

/**
 * The one gate every admin action goes through.
 *
 * Returns null when the caller may proceed, or the whole refusal to hand back
 * unchanged. Handlers are two lines because of it:
 *
 *   var bad = checkAdmin_(body);
 *   if (bad) return bad;
 *
 * A refusal carries `needsSignIn` when signing in again is what would fix it,
 * so the page can offer the button rather than an error nobody can act on.
 *
 * `area` is which part of the page this action belongs to — events, people,
 * notices, rsvps, leaders — checked against the caller's role. Left out for
 * the handful of actions any leader may reach at all, such as opening the
 * page in the first place.
 */
function checkAdmin_(body, area) {
  CALLER = '';
  CALLER_ROLE = '';
  CALLER_SCOPE = null;
  var action = String((body && body.action) || '').toLowerCase();
  var idToken = String((body && body.idToken) || '');

  if (idToken) {
    var who = null;
    try {
      who = verifyIdToken_(idToken);
    } catch (err) {
      return json_({ ok: false, error: String(err && err.message ? err.message : err) });
    }
    if (!who) {
      CALLER = 'an unverified sign-in';
      logAdmin_(action, 'refused: the sign-in did not check out', true);
      return json_({
        ok: false, needsSignIn: true,
        error: 'That sign-in has expired or did not check out. Sign in again.'
      });
    }
    var leader = leaderFor_(who.email);
    if (!leader) {
      CALLER = who.email;
      logAdmin_(action, 'refused: not on the leaders list', true);
      return json_({
        ok: false,
        error: who.email + ' is not on the leaders list. Ask somebody already on ' +
               'it to add you, then sign in again.'
      });
    }
    CALLER = leader.name || who.name || leader.email;
    CALLER_ROLE = leader.role;
    CALLER_SCOPE = leader.scope;
    var short = tooFew_(action, area);
    if (short) return short;
    logAdmin_(action, actionDetail_(body));
    return null;
  }

  if (requireSignIn_()) {
    return json_({
      ok: false, needsSignIn: true,
      error: 'This page needs you to sign in with Google now.'
    });
  }

  var bad = checkPasscode_(body && body.passcode);
  if (bad) return json_({ ok: false, error: bad });
  // The passcode carries no identity, so it cannot carry a role either. It
  // gets all of them, which is one more reason to switch it off: a shared
  // secret is the one way into this page that no level applies to.
  CALLER = 'passcode';
  CALLER_ROLE = 'admin';
  CALLER_SCOPE = null;
  logAdmin_(action, actionDetail_(body));
  return null;
}

/** Refuse when the caller's level does not reach this part of the page. */
function tooFew_(action, area) {
  if (!area) return null;
  var may = ROLES[CALLER_ROLE] || ROLES.leader;
  if (may[area]) return null;
  logAdmin_(action, 'refused: ' + CALLER_ROLE + ' may not reach ' + area, true);
  return json_({
    ok: false,
    error: 'Your account is set to ' + CALLER_ROLE + ', which does not cover that ' +
           'part of this page. Ask an admin if you need it.'
  });
}

/**
 * A line per admin action, so a surprise on the calendar has a trail.
 *
 * Reads are not logged. The event list is re-read every time somebody changes
 * ministry, and a log nobody can skim is a log nobody reads. Refusals are
 * logged whatever the action, because those are the interesting ones.
 *
 * A line means somebody asked for this, not that it worked: the log is written
 * at the gate, before the handler has had its say. That is the honest place
 * for it — an attempt that was allowed and then failed validation is still
 * something the next person will want to see.
 */
var AUDITED_ = {
  'admin.save': 1, 'admin.delete': 1, 'admin.setgroups': 1, 'admin.share': 1,
  'admin.remove': 1, 'admin.notice': 1, 'admin.settings': 1, 'admin.makecard': 1,
  'admin.addleader': 1, 'admin.removeleader': 1
};

function adminLogSheet_() { return tab_(ADMIN_LOG_TAB, ['when', 'who', 'action', 'detail']); }

/** Whatever in this request is worth reading back later. Never the passcode. */
function actionDetail_(body) {
  var bits = [];
  if (body.ministry) bits.push(String(body.ministry));
  if (body.title) bits.push('"' + String(body.title).slice(0, 60) + '"');
  if (body.name) bits.push(String(body.name).slice(0, 60));
  if (body.email) bits.push(String(body.email).slice(0, 80));
  if (body.handle) bits.push('person ' + String(body.handle).slice(0, 24));
  if (body.month) bits.push(String(body.month).slice(0, 12));
  if (body.id) bits.push('#' + String(body.id).slice(0, 24));
  return bits.join(' · ');
}

function logAdmin_(action, detail, always) {
  if (!always && !AUDITED_[action]) return;
  try {
    var sheet = adminLogSheet_();
    sheet.appendRow([
      new Date(),
      (CALLER || 'unknown') + (CALLER_ROLE ? ' (' + CALLER_ROLE + ')' : ''),
      action,
      String(detail || '')
    ]);
    var last = sheet.getLastRow();
    if (last > ADMIN_LOG_MAX + 1) sheet.deleteRows(2, last - ADMIN_LOG_MAX - 1);
  } catch (err) {
    // A log that cannot be written must never stop the thing it is logging.
  }
}

// ---------------------------------------------------------------------------
// The leaders list itself
// ---------------------------------------------------------------------------
//
// Anybody who can already work this page can add somebody to it. That is not
// an escalation while the passcode is still accepted, since a passcode holder
// can do all of this anyway; and once REQUIRE_SIGNIN is on it is exactly the
// right rule — leaders vouch for leaders, and the log says who vouched.
//
// Addresses do reach the browser here, which they deliberately do not for the
// contacts list. A list you cannot see is a list you cannot manage, and this
// one is a handful of leaders rather than the congregation.

function leadersList_() {
  return leaders_().map(function (l) {
    return {
      name: l.name, email: l.email, notes: l.notes,
      role: l.role,
      ministries: l.scope ? l.scope.join(', ') : ''
    };
  });
}

/** Add a row in whatever order this sheet's columns happen to be in. */
function appendLeader_(fields) {
  var sheet = leadersSheet_();
  var headers = leaderHeaders_(sheet, sheet.getLastColumn());
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push(Object.prototype.hasOwnProperty.call(fields, headers[i]) ? fields[headers[i]] : '');
  }
  sheet.appendRow(row);
  LEADERS_CACHE = null;
}

/**
 * The first id in a scope that is not a ministry, or '' if they all are.
 *
 * Worth refusing rather than accepting. A typo in this cell does not fail
 * loudly; it silently scopes somebody to a calendar that does not exist, and
 * they sign in to a page with an empty dropdown and no idea why.
 */
function unknownMinistry_(raw) {
  var wanted = parseScope_(raw);
  if (!wanted) return '';
  var all = allMinistryIds_();
  for (var i = 0; i < wanted.length; i++) {
    if (!all[wanted[i]]) return wanted[i];
  }
  return '';
}

function handleAdminLeaders_(body) {
  var bad = checkAdmin_(body, 'leaders');
  if (bad) return bad;
  return json_({
    ok: true,
    you: CALLER,
    yourRole: CALLER_ROLE,
    signInRequired: requireSignIn_(),
    signInReady: !!googleClientId_(),
    roles: ['admin', 'staff', 'leader', 'viewer'],
    ministries: allMinistries_().map(function (m) {
      return { id: m.id, name: m.name, visibility: m.visibility };
    }),
    leaders: leadersList_()
  });
}

function handleAdminAddLeader_(body) {
  var bad = checkAdmin_(body, 'leaders');
  if (bad) return bad;

  var name = String(body.name || '').trim();
  var email = String(body.email || '').trim();
  if (!name) return json_({ ok: false, error: 'Please enter their name.' });
  if (name.length > 80) return json_({ ok: false, error: 'That name is too long.' });
  if (email.length > 120) return json_({ ok: false, error: 'That email is too long.' });
  if (email.indexOf('@') === -1) {
    return json_({ ok: false, error: 'That email address does not look right.' });
  }

  var already = leaderFor_(email);
  if (already) {
    return json_({ ok: false, error: (already.name || email) + ' is already on the list.' });
  }

  var role = normalizeRole_(body.role);
  var scope = String(body.ministries || '').trim();
  var wrong = unknownMinistry_(scope);
  if (wrong) return json_({ ok: false, error: 'There is no calendar called "' + wrong + '".' });

  appendLeader_({
    name: name,
    email: email,
    active: 'yes',
    role: role,
    ministries: scope,
    added: new Date(),
    notes: 'added by ' + (CALLER || 'passcode')
  });
  return json_({ ok: true, leaders: leadersList_() });
}

/**
 * Change somebody's level, or which calendars they cover.
 *
 * Separate from adding them, so that promoting a leader is not "remove and
 * type it all again" — which is how somebody ends up briefly not on the list
 * at all, and how a scope gets retyped slightly differently.
 */
function handleAdminSetLeader_(body) {
  var bad = checkAdmin_(body, 'leaders');
  if (bad) return bad;

  var email = String(body.email || '').trim();
  var target = leaderFor_(email);
  if (!target) return json_({ ok: false, error: 'They are not on the list.' });

  if (body.role !== undefined) {
    var role = normalizeRole_(body.role);
    // The list must never run out of admins: nobody else can put one back.
    if (target.role === 'admin' && role !== 'admin' && adminCount_() <= 1) {
      return json_({
        ok: false,
        error: 'That is the only admin. Make somebody else an admin first, or ' +
               'nobody can manage this list again.'
      });
    }
    setLeaderCell_(target.row, 'role', role);
  }

  if (body.ministries !== undefined) {
    var scope = String(body.ministries || '').trim();
    var wrong2 = unknownMinistry_(scope);
    if (wrong2) return json_({ ok: false, error: 'There is no calendar called "' + wrong2 + '".' });
    setLeaderCell_(target.row, 'ministries', scope);
  }

  return json_({ ok: true, leaders: leadersList_() });
}

function handleAdminRemoveLeader_(body) {
  var bad = checkAdmin_(body, 'leaders');
  if (bad) return bad;

  var email = String(body.email || '').trim();
  var target = leaderFor_(email);
  if (!target) return json_({ ok: false, error: 'They are not on the list.' });

  // Emptying the list would lock every leader out of the page with no way back
  // in but the script editor, which is the one place nobody can reach from a
  // phone in a church foyer. Losing the last admin is the same thing one step
  // removed: the others could still get in, and none of them could ever add
  // anybody or put an admin back.
  if (leaders_().length <= 1) {
    return json_({
      ok: false,
      error: 'That is the last leader. Add somebody else first, or nobody can get in.'
    });
  }
  if (target.role === 'admin' && adminCount_() <= 1) {
    return json_({
      ok: false,
      error: 'That is the only admin. Make somebody else an admin first, or nobody ' +
             'can manage this list again.'
    });
  }

  leadersSheet_().deleteRow(target.row);
  LEADERS_CACHE = null;
  return json_({ ok: true, leaders: leadersList_() });
}

/**
 * Sign-in, summarised for the health check.
 *
 * Reading the leaders count needs the sheet, which may be the very thing that
 * is broken, so a failure here reports itself rather than taking the whole
 * health check down with it.
 */
function signInHealth_() {
  var out = {
    clientId: !!googleClientId_(),
    required: requireSignIn_(),
    leaders: 0,
    admins: 0
  };
  try {
    out.leaders = leaders_().length;
    out.admins = adminCount_();
  } catch (err) {
    out.detail = String(err && err.message ? err.message : err);
  }
  return out;
}

/** What the admin page needs to know before anybody has said who they are. */
function handleConfig_() {
  return json_({
    ok: true,
    version: VERSION,
    clientId: googleClientId_(),
    signInRequired: requireSignIn_(),
    passcodeSet: !!adminPasscode_()
  });
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
        glbcPinned: ev.pinned ? 'true' : 'false',
        // What the printed card should call this, when the real title is too
        // long or too detailed for a line on a card. Blank means use the title,
        // which is what it will be nearly always.
        glbcCard: String(ev.card || '').trim().slice(0, 80)
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
  var bad = checkAdmin_(body, 'events');
  if (bad) return bad;

  var m = findMinistry_(String(body.ministry || ''));
  if (!m) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!m.calendarId) return json_({ ok: false, error: 'That ministry has no calendar set up.' });
  if (!mayTouchMinistry_(m.id)) return refuseMinistry_(m.name || m.id);
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
  var bad = checkAdmin_(body, 'events');
  if (bad) return bad;

  var m = findMinistry_(String(body.ministry || ''));
  if (!m) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!m.calendarId) return json_({ ok: false, error: 'That ministry has no calendar set up.' });
  if (!mayTouchMinistry_(m.id)) return refuseMinistry_(m.name || m.id);

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
      card: shared.glbcCard || '',
      rrule: (e.recurrence || []).filter(function (r) { return r.indexOf('RRULE') === 0; })[0] || ''
    };
  }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

  return json_({ ok: true, ministry: m.id, events: items });
}

function handleAdminDelete_(body) {
  var bad = checkAdmin_(body, 'events');
  if (bad) return bad;

  var m = findMinistry_(String(body.ministry || ''));
  if (!m || !m.calendarId) return json_({ ok: false, error: 'Pick a calendar.' });
  if (!mayTouchMinistry_(m.id)) return refuseMinistry_(m.name || m.id);
  if (!body.id) return json_({ ok: false, error: 'Nothing to delete.' });

  calendarService_().Events.remove(m.calendarId, body.id);
  return json_({ ok: true, deleted: body.id });
}

/** Confirms a passcode and hands back the calendars that can be written to. */
function handleAdminHello_(body) {
  var bad = checkAdmin_(body);
  if (bad) return bad;
  var list = allMinistries_().filter(function (m) {
    return !!m.calendarId && mayTouchMinistry_(m.id);
  });
  return json_({
    ok: true,
    you: CALLER,
    signedIn: CALLER !== 'passcode',
    role: CALLER_ROLE,
    // What this person may reach, so the page can leave out the rest. It is
    // the same table the endpoint refuses by, sent rather than re-stated, so
    // the two cannot drift apart.
    can: ROLES[CALLER_ROLE] || ROLES.leader,
    scoped: !!CALLER_SCOPE,
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
// These two actions move that into the admin form. Everyone who gets through
// the gate can do all of it, so anyone who can add somebody to Youth Leaders
// can also add them to Worship. That is a deliberate simplification while the
// Leaders tab is a handful of people who already have every private calendar
// between them, and it is the thing to revisit before a pastor's calendar
// exists. See docs/ADMIN.md.
//
// A person is addressed by their token. It is never shown in the admin page,
// but it does reach that browser, so a leader could read one from the page
// source. That grants nothing they do not already have: getting through the
// gate already lets them list private calendar contents directly.

/** Every ministry id, public and private, as an allow-list for writes. */
function allMinistryIds_() {
  var ids = {};
  allMinistries_().forEach(function (m) { ids[m.id] = m.name || m.id; });
  return ids;
}

function handleAdminPeople_(body) {
  var bad = checkAdmin_(body, 'people');
  if (bad) return bad;

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
  var bad = checkAdmin_(body, 'people');
  if (bad) return bad;

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

  // A scoped leader may only move the calendars they cover, and the page
  // sends the whole set because the whole set is what it drew. Saving that
  // verbatim would clear every column outside their scope — a silent removal
  // of somebody else's private calendar, done by a person who never saw it.
  if (CALLER_SCOPE) {
    var keep = [];
    var current = groupsOf_(headers, found.values, all);
    for (var k = 0; k < current.length; k++) {
      if (!mayTouchMinistry_(current[k])) keep.push(current[k]);
    }
    var mine = [];
    for (var g = 0; g < groups.length; g++) {
      if (mayTouchMinistry_(groups[g])) mine.push(groups[g]);
    }
    groups = keep.concat(mine);
  }

  writeGroups_(sheet, headers, found.row, groups, all);
  var after = sheet.getRange(found.row, 1, 1, headers.length).getValues()[0];

  // On the link route this needs nothing from anybody: their address never
  // changes, so the new group simply appears at the next sync.
  //
  // On the Google route the access is granted and Google emails them the link
  // that adds it, because nobody is in front of a page to be shown buttons.
  // The card also shows that link, for when the email does not arrive or a
  // text is simply the way that person is actually reachable.
  var emailCol = columnIndex_(headers, 'email');
  var email = emailCol === -1 ? '' : String(after[emailCol] || '').trim();
  var shared = null;
  if (email) {
    try {
      if (isSharedWith_(email)) shared = syncCalendarSharing_(email, groups, true);
    } catch (err) {
      shared = { ok: false, failed: [err && err.message ? err.message : String(err)] };
    }
  }

  return json_({
    ok: true,
    handle: token,
    groups: groups,
    email: email,
    feedUrl: feedUrlFor_(token),
    shared: shared
  });
}

/**
 * Put somebody on the Google route deliberately.
 *
 * Changing their groups only re-syncs Google access for people who already
 * have some, which is right — nobody's calendars should be pushed into an
 * account that never asked. But it leaves a hole: revoke a person's last
 * calendar and they stop counting as being on the Google route, so ticking it
 * back on would silently grant nothing. This is the explicit way back in, and
 * it is also how a leader sets somebody up who cannot manage the page.
 *
 * Notified, because nobody is in front of a page here. The response also
 * carries the add links, so a leader can send one directly when the email does
 * not arrive or a text is how that person is actually reachable.
 */
function handleAdminShare_(body) {
  var bad = checkAdmin_(body, 'people');
  if (bad) return bad;

  var token = String(body.handle || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'Unknown person.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) return json_({ ok: false, error: 'That person is no longer in the sheet.' });

  var emailCol = columnIndex_(headers, 'email');
  var email = emailCol === -1 ? '' : String(found.values[emailCol] || '').trim();
  if (!email || email.indexOf('@') === -1) {
    return json_({ ok: false, error: 'No email address on their row, so there is no account to share with.' });
  }

  var groups = groupsOf_(headers, found.values, allMinistryIds_());
  if (!groups.length) return json_({ ok: false, error: 'They have no calendars ticked yet.' });

  var result = syncCalendarSharing_(email, groups, true);
  if (!result.ok && !(result.added || []).length) {
    return json_({
      ok: false,
      error: 'Google would not share those. ' + ((result.failed || [])[0] || result.reason || '')
    });
  }
  return json_({ ok: true, email: email, shared: result });
}

/**
 * Remove somebody completely.
 *
 * Deleting the row alone was never enough. It stops their feed at the next
 * sync, because the job serves only tokens it finds in the sheet — but Google
 * calendar access is granted per account and outlives the sheet entirely. A
 * removed person would have kept reading every calendar shared with them,
 * private ones included, with nothing left in the sheet to show it or undo it.
 *
 * So access is revoked FIRST and the row deleted only if that worked. The
 * other order loses the email address on the way to needing it, and leaves
 * access nobody can find to revoke.
 */
function handleAdminRemove_(body) {
  var bad = checkAdmin_(body, 'people');
  if (bad) return bad;

  // Removing somebody takes away every calendar they hold, including ones
  // this person cannot see. That is not a scoped decision.
  if (CALLER_SCOPE) {
    return json_({
      ok: false,
      error: 'Removing somebody completely is for an account that covers every ' +
             'calendar. Take away the ones you cover instead.'
    });
  }

  var token = String(body.handle || '').trim();
  if (!validToken_(token)) return json_({ ok: false, error: 'Unknown person.' });

  var sheet = sheet_();
  var headers = headers_(sheet);
  var found = findByToken_(sheet, headers, token);
  if (!found) return json_({ ok: false, error: 'That person is no longer in the sheet.' });

  var nameCol = columnIndex_(headers, 'name');
  var emailCol = columnIndex_(headers, 'email');
  var name = nameCol === -1 ? '' : String(found.values[nameCol] || '').trim();
  var email = emailCol === -1 ? '' : String(found.values[emailCol] || '').trim();

  var revoked = [];
  if (email && email.indexOf('@') !== -1) {
    // An empty group list means "should have none of them", which is exactly
    // what removal means, so the ordinary sync does the work.
    var result = syncCalendarSharing_(email, [], false);
    if (!result.ok) {
      return json_({
        ok: false,
        error: 'Could not take away their Google access, so the row has been left ' +
          'alone: removing it now would hide access nobody can find. ' +
          ((result.failed || [])[0] || result.reason || '')
      });
    }
    revoked = result.removed || [];
  }

  sheet.deleteRow(found.row);

  return json_({
    ok: true,
    name: name,
    email: email,
    revoked: revoked,
    // Their feed is served from the sheet, so it stops existing on the next
    // run rather than this instant.
    rebuild: requestRebuild_('removal')
  });
}

// ---------------------------------------------------------------------------
// Settings the job reads
// ---------------------------------------------------------------------------

function settingsSheet_() { return tab_(SETTINGS_TAB, ['key', 'value', 'what it is']); }

function readSetting_(key) {
  var sheet = settingsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return '';
  var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === key) return String(rows[i][1] || '');
  }
  return '';
}

function writeSetting_(key, value, what) {
  var sheet = settingsSheet_();
  var last = sheet.getLastRow();
  if (last >= 2) {
    var rows = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.appendRow([key, value, what || '']);
}

/**
 * The standing notes printed at the foot of the calendar card.
 *
 * One per line. They exist so a fortnightly supper is one sentence rather than
 * eight identical dated lines eating the card, so this is where anything on a
 * regular rhythm belongs.
 */
function handleAdminSettings_(body) {
  var bad = checkAdmin_(body, 'notices');
  if (bad) return bad;

  if (body.read) {
    return json_({
      ok: true,
      cardNotes: readSetting_('cardNotes'),
      cardEmail: readSetting_('cardEmail')
    });
  }

  if (body.cardNotes !== undefined) {
    var notes = String(body.cardNotes).trim();
    if (notes.length > 400) {
      return json_({ ok: false, error: 'That is longer than the foot of a card can hold.' });
    }
    writeSetting_('cardNotes', notes,
      'Standing notes printed at the foot of the calendar card, one per line.');
  }

  if (body.cardEmail !== undefined) {
    var who = String(body.cardEmail).trim();
    // A name from the Contacts tab, not an address. The address is resolved
    // when the card is sent, so correcting somebody's email in one cell fixes
    // this too, and no address is ever handed to a browser.
    if (who && !contactEmails_(who).length) {
      return json_({ ok: false, error: 'That contact has no email address on the Contacts tab.' });
    }
    writeSetting_('cardEmail', who,
      'Who the generated calendar card is emailed to. A name from the Contacts tab.');
  }

  return json_({
    ok: true,
    cardNotes: readSetting_('cardNotes'),
    cardEmail: readSetting_('cardEmail')
  });
}

/**
 * Ask GitHub to build the calendar card now.
 *
 * A button here rather than a trip to the Actions tab. Making a card is a
 * once-a-month job for whoever runs the church calendar, not a build task, and
 * sending somebody into a continuous integration UI to do it is how a feature
 * quietly stops being used.
 *
 * Firing it is all this can do. The run takes a minute or two, and what comes
 * back is an email with the card attached — or, if it fails, an email saying
 * so. That is the reason this can be fire-and-forget: the answer arrives by
 * itself either way.
 */
/**
 * Read a month the way somebody actually types one.
 *
 * 01/2027, 1/27, 2027-01, Jan 2027 and the rest all mean the same thing.
 * Insisting on one spelling means the person who types 1/27 gets an error for
 * no reason a human would accept.
 *
 * parseMonth in job/src/month.ts is the same rule and carries the tests. This
 * copy exists so a typo is caught while somebody is still looking at the box,
 * rather than arriving as a failure email a minute later.
 */
function parseMonth_(raw) {
  var names = ['january', 'february', 'march', 'april', 'may', 'june',
               'july', 'august', 'september', 'october', 'november', 'december'];
  var parts = String(raw == null ? '' : raw).trim().split(/[^0-9A-Za-z]+/)
    .filter(function (p) { return p; });
  if (parts.length !== 2) return null;

  var year = null, month = null, short = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (/^\d{4}$/.test(part)) {
      year = Number(part);
    } else if (/^\d{1,2}$/.test(part)) {
      short.push(Number(part));
    } else {
      var w = part.toLowerCase(), found = -1;
      for (var n = 0; n < names.length; n++) {
        if (names[n] === w || (w.length >= 3 && names[n].indexOf(w) === 0)) { found = n; break; }
      }
      if (found === -1) return null;
      month = found + 1;
    }
  }

  if (month === null && short.length === 2) {
    // 27-01 can only be a year and a month; 01-27 reads as month and year.
    if (short[0] > 12) { year = 2000 + short[0]; month = short[1]; }
    else { month = short[0]; year = 2000 + short[1]; }
  } else if (short.length === 1) {
    if (year === null) year = 2000 + short[0];
    else if (month === null) month = short[0];
    else return null;
  } else if (short.length > 2) {
    return null;
  }

  if (year === null || month === null) return null;
  if (month < 1 || month > 12) return null;
  // Narrow enough that a typo like 0227 is refused rather than quietly
  // producing a card for the third century.
  if (year < 2020 || year > 2099) return null;
  return year + '-' + (month < 10 ? '0' + month : String(month));
}

function handleAdminMakeCard_(body) {
  var bad = checkAdmin_(body, 'notices');
  if (bad) return bad;

  var props = PropertiesService.getScriptProperties();
  var repo = String(props.getProperty('GITHUB_REPO') || '').trim();
  var token = String(props.getProperty('GITHUB_DISPATCH_TOKEN') || '').trim();
  if (!repo || !token) {
    return json_({
      ok: false,
      error: 'This needs GITHUB_REPO and GITHUB_DISPATCH_TOKEN in Project Settings > ' +
        'Script Properties. See docs/CARD.md.'
    });
  }

  var typed = String(body.month || '').trim();
  var month = '';
  if (typed) {
    month = parseMonth_(typed);
    if (!month) {
      return json_({
        ok: false,
        error: 'Could not read "' + typed + '" as a month. Try 01/2027, 1/27 or Jan 2027.'
      });
    }
  }

  // Building a card is not free and it emails somebody. Two people pressing
  // the button, or one pressing it twice because nothing visibly happened,
  // should not send two cards.
  var cache = CacheService.getScriptCache();
  if (cache.get('card_asked')) {
    return json_({ ok: false, error: 'A card was already asked for in the last few minutes.' });
  }

  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/dispatches', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'make-card', client_payload: { month: month } })
  });

  if (res.getResponseCode() !== 204) {
    return json_({
      ok: false,
      error: 'GitHub refused: ' + res.getResponseCode() + '. Check the token has ' +
        'Contents: read and write on this repository.'
    });
  }

  cache.put('card_asked', '1', 180);
  var to = readSetting_('cardEmail');
  return json_({ ok: true, month: month, emailTo: to });
}

/**
 * Email the finished calendar card, or say why there isn't one.
 *
 * The card is built by a GitHub Action, which has no way to send mail; this
 * script does, and it already knows how to turn a contact's name into
 * addresses. So the Action hands the PDF over and this posts it.
 *
 * The bytes come through the request rather than being fetched from the site,
 * because the site does not have the new card yet: it is published by the same
 * run and takes a couple of minutes to deploy. Waiting on that would make
 * sending depend on a deploy, which is the sort of timing bug that works every
 * time until the one time it matters.
 *
 * A failed build sends mail too. Silence is the worst outcome — somebody would
 * be waiting on a card that was never coming, and would find out when the
 * printer asked.
 */
function handleCardMail_(body) {
  var bad = checkAdmin_(body, 'notices');
  if (bad) return bad;

  var who = String(body.contact || '').trim();
  if (!who) return json_({ ok: false, error: 'Nobody is set to receive the card.' });

  var to = contactEmails_(who);
  if (!to.length) {
    return json_({ ok: false, error: 'No email address on the Contacts tab for ' + who + '.' });
  }

  var months = String(body.months || 'the next two months');

  if (body.error) {
    MailApp.sendEmail({
      to: to.join(','),
      subject: 'The calendar card could NOT be made',
      body: 'The calendar card for ' + months + ' failed to build, so there is ' +
        'nothing to send.\n\n' + String(body.error).slice(0, 1500) + '\n\n' +
        'Nothing has been published, and the last card is untouched.\n' +
        SITE + '\n'
    });
    return json_({ ok: true, sent: to.length, kind: 'failure' });
  }

  if (!body.pdf) return json_({ ok: false, error: 'No card was attached.' });

  var name = String(body.filename || 'calendar-card.pdf').replace(/[^A-Za-z0-9._-]/g, '');
  var blob = Utilities.newBlob(
    Utilities.base64Decode(String(body.pdf)), 'application/pdf', name);

  MailApp.sendEmail({
    to: to.join(','),
    subject: 'Calendar card: ' + months,
    body: 'The calendar card for ' + months + ' is attached, ready to send to ' +
      'the printer.\n\n' +
      'Half sheet, 5.5 by 8.5 inches, printed both sides. It prints in colour ' +
      'or black and white from this same file.\n\n' +
      'If something needs changing, fix it on the calendar and run "Make the ' +
      'calendar card" again — this file is only a copy, nothing has been sent ' +
      'anywhere else.\n\n' + SITE + '\n',
    attachments: [blob]
  });

  return json_({ ok: true, sent: to.length, kind: 'card' });
}

// ---------------------------------------------------------------------------
// The notice on the wall display
// ---------------------------------------------------------------------------
//
// One message, shown above everything else on the TV. For "service moved to
// 6pm" on a Sunday morning, which is the case that decides how this is built.
//
// It lives in a script property rather than the sheet or the repo, because the
// whole point is that it changes in seconds from a phone. Anything that has to
// go through the hourly job could sit for fifty-five minutes, by which time the
// service has started.
//
// The end date is stored, and expiry is enforced HERE rather than on the
// screen. A stale "Revival this week!" three weeks later is worse than no
// notice at all, and a screen that has been running since spring should not be
// the thing deciding whether a message is still true.

var NOTICE_KEY = 'TV_NOTICE';

/** Today in church time, as yyyy-MM-dd, for comparing against the end date. */
function todayLocal_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

function readNotice_() {
  var raw = PropertiesService.getScriptProperties().getProperty(NOTICE_KEY);
  if (!raw) return null;
  try {
    var n = JSON.parse(raw);
    if (!n || !n.text) return null;
    return n;
  } catch (err) {
    return null;
  }
}

/**
 * The notice, if it is still current.
 *
 * Public and unauthenticated, because the wall display has no way to hold a
 * passcode and this is a message intended for a room full of people anyway.
 * It returns only what is on screen: nothing about who set it or when.
 */
function handleNotice_(body) {
  var n = readNotice_();
  if (!n) return json_({ ok: true, notice: null });

  // Shown through the END of the chosen day, not from some time on it. "Until
  // Sunday" means Sunday, and a notice vanishing mid-service would be worse
  // than one lingering an afternoon.
  if (n.until && n.until < todayLocal_()) return json_({ ok: true, notice: null });

  return json_({ ok: true, notice: { text: n.text, until: n.until || '' } });
}

/**
 * Read, set or clear it. Leaders only.
 *
 * Sending no text clears it. That is deliberately the same action rather than
 * a separate one: whoever put a notice up in a hurry should be able to take it
 * down by emptying the box they typed it into.
 */
function handleAdminNotice_(body) {
  var bad = checkAdmin_(body, 'notices');
  if (bad) return bad;

  var props = PropertiesService.getScriptProperties();

  if (body.read) {
    var current = readNotice_();
    return json_({
      ok: true,
      notice: current ? { text: current.text, until: current.until || '' } : null,
      expired: !!(current && current.until && current.until < todayLocal_()),
      today: todayLocal_()
    });
  }

  var text = String(body.text || '').trim();
  if (!text) {
    props.deleteProperty(NOTICE_KEY);
    return json_({ ok: true, notice: null, cleared: true });
  }
  if (text.length > 240) {
    return json_({ ok: false, error: 'Keep it under 240 characters — it has to be readable across a room.' });
  }

  var until = String(body.until || '').trim();
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return json_({ ok: false, error: 'That end date does not look right.' });
  }
  if (until && until < todayLocal_()) {
    // Saving something already expired would take it down the moment it went
    // up, and look like the save had failed.
    return json_({ ok: false, error: 'That date has already passed, so nothing would show.' });
  }

  props.setProperty(NOTICE_KEY, JSON.stringify({ text: text, until: until }));
  return json_({ ok: true, notice: { text: text, until: until } });
}

// ---------------------------------------------------------------------------
// Contacts, and RSVPs to events
// ---------------------------------------------------------------------------
//
// An event names a person to respond to. People say they are coming, and that
// person needs a headcount.
//
// Two rules shape all of this.
//
// Email addresses never leave the server. The dropdown gets names; an RSVP
// carries an event id. The address is looked up here, at the moment of
// sending, which also means correcting somebody's address in one cell fixes
// every future email rather than leaving it wrong on two hundred past events.
//
// And the contact is sent one message a day with the WHOLE list, not one per
// reply. Forty families answering a trip would otherwise be forty emails, and
// the church account can send to about a hundred recipients a day in total.

/** Make a tab with these headers if it is not there yet. */
function tab_(name, headers) {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function contactsSheet_() { return tab_(CONTACTS_TAB, ['name', 'email', 'active']); }
function rsvpsSheet_() {
  return tab_(RSVPS_TAB, [
    'when', 'eventId', 'starts', 'event', 'ministry',
    'name', 'count', 'phone', 'note', 'contact'
  ]);
}

/**
 * Split an address cell into addresses.
 *
 * A contact is a role as often as a person: "Andrea Hutchins and Michelle
 * Jenson" is one line on an event and two people who both need the headcount.
 * Semicolon or comma separated, so it reads the way somebody would type it.
 */
function addresses_(cell) {
  return String(cell || '')
    .split(/[;,]/)
    .map(function (a) { return a.trim(); })
    .filter(function (a) { return a && a.indexOf('@') !== -1; });
}

/** Everyone who may be picked as a contact. Includes addresses; never returned to a browser. */
function contacts_() {
  var sheet = contactsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0] || '').trim();
    var email = String(rows[i][1] || '').trim();
    var active = String(rows[i][2] || '').trim();
    // A blank "active" means yes. Leaders should not have to tick a box to
    // make a new row work; they should have to tick one to switch it off.
    if (!name) continue;
    if (active && /^(no|n|off|false|0)$/i.test(active)) continue;
    out.push({ name: name, emails: addresses_(email) });
  }
  return out;
}

function contactEmails_(name) {
  var wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return [];
  var list = contacts_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name.toLowerCase() === wanted) return list[i].emails;
  }
  return [];
}

/**
 * The names the admin form offers.
 *
 * Names only. The page has no use for an address, and a passcode on a page is
 * not a reason to hand every leader's email to a browser.
 */
function handleContacts_(body) {
  var bad = checkAdmin_(body);
  if (bad) return bad;
  return json_({
    ok: true,
    contacts: contacts_().map(function (c) {
      return { name: c.name, reachable: c.emails.length > 0 };
    })
  });
}

/**
 * Find a published event, which is also how an RSVP is authorised.
 *
 * events.json contains public events only, by construction. Requiring a match
 * means nobody can RSVP to a private meeting, invent an event id, or attach
 * responses to something that does not exist — without this endpoint needing
 * any idea of what is private.
 */
function publishedEvent_(eventId, starts) {
  var res = UrlFetchApp.fetch(EVENTS_JSON, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read the calendar.');
  var events = (JSON.parse(res.getContentText()).events || []);
  for (var i = 0; i < events.length; i++) {
    if (events[i].uid === eventId && String(events[i].start) === String(starts)) return events[i];
  }
  return null;
}

function handleRsvp_(body) {
  var eventId = String(body.eventId || '').trim();
  var starts = String(body.starts || '').trim();
  var name = String(body.name || '').trim();
  var count = parseInt(body.count, 10);
  var phone = String(body.phone || '').trim();
  var note = String(body.note || '').trim();

  if (!eventId || !starts) return json_({ ok: false, error: 'Which event is this for?' });
  if (name.length < 2) return json_({ ok: false, error: 'Please give your name.' });
  if (name.length > 80) return json_({ ok: false, error: 'That name is too long.' });
  if (!(count >= 1 && count <= 99)) return json_({ ok: false, error: 'How many are coming?' });
  if (phone.length > 30) return json_({ ok: false, error: 'That phone number is too long.' });
  if (note.length > 300) return json_({ ok: false, error: 'Please keep the note shorter.' });

  // Nothing here is behind a login, so it must not be usable as a way to
  // flood the sheet. A quiet cap, well above any real Sunday.
  var cache = CacheService.getScriptCache();
  var minute = 'rsvp-rate-' + Math.floor(Date.now() / 60000);
  var recent = parseInt(cache.get(minute) || '0', 10);
  if (recent > 60) return json_({ ok: false, error: 'Too many responses at once. Try again in a minute.' });
  cache.put(minute, String(recent + 1), 120);

  var event = publishedEvent_(eventId, starts);
  if (!event) return json_({ ok: false, error: 'That event is not on the calendar any more.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = rsvpsSheet_();
    var headers = headers_(sheet);
    var row = [
      new Date(), eventId, starts, event.title || '', event.ministry || '',
      name, count, phone, note, event.contact || ''
    ];

    // Answering again replaces the earlier answer rather than adding a second
    // one. People change their minds about numbers, and a leader counting a
    // list should not have to work out which "Jane Doe" is current.
    var last = sheet.getLastRow();
    var replaced = false;
    if (last > 1) {
      var existing = sheet.getRange(2, 1, last - 1, headers.length).getValues();
      for (var r = 0; r < existing.length; r++) {
        if (String(existing[r][1]) === eventId &&
            String(existing[r][2]) === starts &&
            String(existing[r][5]).trim().toLowerCase() === name.toLowerCase()) {
          sheet.getRange(r + 2, 1, 1, row.length).setValues([row]);
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) sheet.appendRow(row);

    return json_({ ok: true, event: event.title || '', updated: replaced });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Every response, for the leaders' page.
 *
 * Everything, including events long finished. Nothing is ever deleted here:
 * "how many came to the fall festival last year" is the question that makes
 * this worth keeping, and it cannot be answered from a list that quietly drops
 * anything in the past. The page decides what to show; this returns the lot.
 */
function handleAdminRsvps_(body) {
  var bad = checkAdmin_(body, 'rsvps');
  if (bad) return bad;

  var sheet = rsvpsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, rsvps: [] });

  var rows = sheet.getRange(2, 1, last - 1, 10).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][1] || '').trim()) continue;
    // A headcount is about somebody's own event. A scoped leader seeing every
    // other ministry's replies would be reading a list of names and phone
    // numbers that is none of their business.
    if (!mayTouchMinistry_(rows[i][4])) continue;
    out.push({
      when: rows[i][0] ? new Date(rows[i][0]).toISOString() : '',
      eventId: String(rows[i][1]),
      starts: String(rows[i][2]),
      event: String(rows[i][3] || ''),
      ministry: String(rows[i][4] || ''),
      name: String(rows[i][5] || ''),
      count: Number(rows[i][6]) || 0,
      phone: String(rows[i][7] || ''),
      note: String(rows[i][8] || ''),
      contact: String(rows[i][9] || '')
    });
  }
  return json_({ ok: true, rsvps: out });
}

// ---------------------------------------------------------------------------
// The daily digest
// ---------------------------------------------------------------------------
//
// Run once a day by a time trigger. Set it up by picking setupDailyDigest from
// the dropdown at the top of the editor and pressing Run, once.
//
// Both functions below need scopes that nothing else here uses, and
// appsscript.json lists scopes explicitly, so Apps Script asks for exactly
// what is listed and refuses the rest:
//
//   script.scriptapp   to create the daily trigger
//   script.send_mail   to send the digest
//
// If either is missing the failure is "Specified permissions are not
// sufficient", naming the call rather than the manifest.

function setupDailyDigest() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailyRsvpDigest') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('dailyRsvpDigest')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone('America/New_York')
    .create();
  Logger.log('Daily RSVP digest will run each morning around 7am Eastern.');
}

function todayKey_(date) {
  return Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd');
}

/**
 * One email per contact, once a day, only when something moved.
 *
 * It carries the WHOLE list rather than the day's additions, because the
 * question a leader is holding is "how many am I cooking for", not "who
 * replied since yesterday". A digest of additions makes them add up numbers
 * across a week of emails.
 *
 * Silence is meaningful: no email means nobody responded yesterday, and the
 * last one they received is still accurate.
 */
function dailyRsvpDigest() {
  var sheet = rsvpsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;

  var rows = sheet.getRange(2, 1, last - 1, 10).getValues();
  var today = todayKey_(new Date());
  var now = new Date();

  // contact -> event key -> { title, starts, ministry, people[], changed }
  var byContact = {};
  for (var i = 0; i < rows.length; i++) {
    var contact = String(rows[i][9] || '').trim();
    if (!contact) continue;

    var starts = String(rows[i][2] || '');
    // A finished event is not something anybody still needs a headcount for.
    if (starts && new Date(starts) < now) continue;

    var key = String(rows[i][1]) + '|' + starts;
    if (!byContact[contact]) byContact[contact] = {};
    if (!byContact[contact][key]) {
      byContact[contact][key] = {
        title: String(rows[i][3] || ''),
        starts: starts,
        ministry: String(rows[i][4] || ''),
        people: [],
        total: 0,
        changed: false
      };
    }
    var entry = byContact[contact][key];
    entry.people.push({
      name: String(rows[i][5] || ''),
      count: Number(rows[i][6]) || 0,
      phone: String(rows[i][7] || ''),
      note: String(rows[i][8] || '')
    });
    entry.total += Number(rows[i][6]) || 0;
    if (rows[i][0] && todayKey_(new Date(rows[i][0])) === today) entry.changed = true;
  }

  for (var name in byContact) {
    if (!byContact.hasOwnProperty(name)) continue;
    var emails = contactEmails_(name);
    if (!emails.length) continue;

    var events = byContact[name];
    var moved = [];
    for (var k in events) {
      if (events.hasOwnProperty(k) && events[k].changed) moved.push(events[k]);
    }
    if (!moved.length) continue;

    var lines = [];
    var heading = [];
    for (var k2 in events) {
      if (!events.hasOwnProperty(k2)) continue;
      var e = events[k2];
      var when = e.starts ? Utilities.formatDate(new Date(e.starts), 'America/New_York', 'EEEE d MMMM') : '';
      lines.push('');
      lines.push(e.title + (when ? '  —  ' + when : ''));
      lines.push(e.total + ' coming, ' + e.people.length + ' response' + (e.people.length === 1 ? '' : 's'));
      lines.push('');
      e.people.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      for (var pi = 0; pi < e.people.length; pi++) {
        var person = e.people[pi];
        var bits = ['  ' + person.name + ' — ' + person.count];
        if (person.phone) bits.push('  ' + person.phone);
        if (person.note) bits.push('  "' + person.note + '"');
        lines.push(bits.join('\n'));
      }
      if (e.changed) heading.push(e.title);
    }

    var subject = heading.length === 1
      ? 'RSVPs for ' + heading[0]
      : 'RSVPs for ' + heading.length + ' events';

    MailApp.sendEmail({
      // Everyone on that contact row, in one message, so they can see each
      // other has it and nobody chases the same family twice.
      to: emails.join(','),
      subject: subject,
      body: 'Hello ' + name + ',\n\n' +
        'Here is everybody who has responded so far. This is the full list, not ' +
        'just yesterday\'s replies, so you can read the numbers straight off it.\n' +
        lines.join('\n') + '\n\n' +
        'You only get this on days when something changed. No email means the ' +
        'list above is still what it was.\n\n' +
        SITE + '\n'
    });
  }
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

/**
 * Read access for one address on one calendar.
 *
 * notify says whether Google should email them, and the answer turns on
 * whether anybody is looking at a page.
 *
 * Access and subscription are separate. The church account can grant a
 * calendar; only the account holder can put it in their own list, and nothing
 * anywhere lets an owner do that for them. So SOMEBODY has to hand that person
 * a link, and the only question is who.
 *
 *   - The person themselves, on signup or preferences: no email. They are
 *     looking at the page, so it shows them add buttons. Sending them to their
 *     inbox instead, mid-signup, in a church foyer, loses people.
 *   - A leader adding somebody to a private calendar: email. That person is
 *     not looking at anything, and the alternative is the leader copying a
 *     link and sending it by hand. Google's invitation carries exactly the
 *     same link and costs the leader nothing.
 *
 * Same number of taps for the recipient either way. The difference is only
 * whether the leader does the delivering.
 */
function grantCalendar_(calendarId, email, notify) {
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
    { sendNotifications: !!notify }
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
function syncCalendarSharing_(email, groups, notify) {
  var address = String(email || '').trim();
  if (!address || address.indexOf('@') === -1) {
    return { ok: false, reason: 'no email address on file' };
  }

  var wanted = {};
  (groups || []).forEach(function (g) { wanted[g] = true; });

  var added = [], removed = [], failed = [], mine = [];
  allMinistries_().forEach(function (m) {
    if (!m.calendarId) return;
    try {
      if (wanted[m.id]) {
        if (grantCalendar_(m.calendarId, address, notify) === 'granted') added.push(m.name);
        // Everything they are entitled to, whether this run granted it or a
        // previous one did. Somebody who tries twice must still get their
        // links; saying "you already have those" and stopping is the dead end
        // that made the first attempt look like it had failed.
        mine.push({ id: m.id, name: m.name, add: addToCalendarUrl_(m.calendarId) });
      } else {
        if (revokeCalendar_(m.calendarId, address) === 'revoked') removed.push(m.name);
      }
    } catch (err) {
      failed.push(m.name + ': ' + (err && err.message ? err.message : err));
    }
  });

  return {
    ok: failed.length === 0,
    added: added, removed: removed, failed: failed, calendars: mine
  };
}

/**
 * A link that puts a calendar somebody already has access to into their list.
 *
 * Granting access and subscribing are two different things in Google Calendar,
 * and only the first is something the church account can do for somebody else.
 * With invitation emails switched on, the email's own "add" link does the
 * second; with them off, access was granted silently and nothing appeared,
 * which read as the share having failed.
 *
 * So the page hands over these instead: one tap each, no inbox, and it works
 * on the phone in their hand, which is the whole reason this route exists.
 */
function addToCalendarUrl_(calendarId) {
  return 'https://calendar.google.com/calendar/render?cid=' +
    encodeURIComponent(calendarId);
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
    failed: result.failed,
    calendars: result.calendars
  });
}
