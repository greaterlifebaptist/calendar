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
var VERSION = 2;

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
    actions: ['signup', 'load', 'save', 'rotate'],
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
