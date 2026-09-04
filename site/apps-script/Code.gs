/**
 * GLBC calendar signup endpoint.
 *
 * Bound to the Calendar Permissions spreadsheet, deployed as a web app that
 * runs as the church account. The website is static files on GitHub Pages and
 * cannot hold a service account key, so this is the only thing that may write
 * to the sheet.
 *
 * Its real job is refusing things. A browser form can be edited by anyone who
 * opens the developer tools, so every rule that matters is enforced here:
 *
 *   - Only PUBLIC ministries can be self-selected. Nobody adds themselves to
 *     youth-leaders or worship, no matter what the browser sends.
 *   - The allowed list is read from the site's own events.json rather than
 *     hardcoded, so it cannot drift out of step with the job's config.
 *   - Tokens are generated here, never accepted from the caller.
 *
 * Deployment steps are in docs/SIGNUP.md.
 */

var SITE = 'https://calendars.greaterlifebaptistchurch.com';
var EVENTS_JSON = SITE + '/events.json';
var FEED_BASE = SITE + '/f/';
var TAB = 'People';

/** Token length in bytes. Matches job/src/sheet.ts. */
var TOKEN_BYTES = 16;

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  // Useful for confirming the deployment is alive without writing anything.
  return json_({ ok: true, service: 'glbc-signup' });
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
  var bytes = [];
  for (var i = 0; i < TOKEN_BYTES; i++) bytes.push(Math.floor(Math.random() * 256));
  // Utilities.getUuid is backed by a proper generator; mixing it in avoids
  // relying on Math.random alone for something that guards a private feed.
  var uuid = Utilities.getUuid().replace(/-/g, '');
  var hex = bytes
    .map(function (b) { return ('0' + b.toString(16)).slice(-2); })
    .join('');
  var mixed = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    hex + uuid + String(Date.now())
  );
  return mixed
    .slice(0, TOKEN_BYTES)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

function sheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
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
    var name = String(body.name || '').trim();
    var email = String(body.email || '').trim();
    var wanted = Array.isArray(body.groups) ? body.groups.map(String) : [];

    if (!name) return json_({ ok: false, error: 'Please enter your name.' });
    if (name.length > 80) return json_({ ok: false, error: 'That name is too long.' });
    if (email && email.length > 120) return json_({ ok: false, error: 'That email is too long.' });
    if (email && email.indexOf('@') === -1) {
      return json_({ ok: false, error: 'That email address does not look right.' });
    }
    if (!wanted.length) return json_({ ok: false, error: 'Pick at least one calendar.' });

    var allowed = publicMinistries_();
    var groups = [];
    for (var i = 0; i < wanted.length; i++) {
      // Silently dropping a rejected group would hand somebody a feed missing
      // what they asked for. Refuse the whole request and say which.
      if (!allowed.hasOwnProperty(wanted[i])) {
        return json_({ ok: false, error: 'That calendar is not available to sign up for.' });
      }
      if (groups.indexOf(wanted[i]) === -1) groups.push(wanted[i]);
    }

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

    var values = headers.map(function (h) {
      var key = h.toLowerCase();
      if (key === 'name') return name;
      if (key === 'email') return email;
      if (key === 'token') return token;
      if (key === 'created') return today;
      // Every other column is a ministry. A private one is never in `allowed`,
      // so it is left exactly as a leader set it and is never cleared here.
      if (!allowed.hasOwnProperty(key)) return null;
      return groups.indexOf(key) !== -1 ? 'x' : '';
    });

    if (existingRow !== -1) {
      // Write cell by cell so a null (a private column) is left untouched.
      for (var c = 0; c < values.length; c++) {
        if (values[c] === null) continue;
        sheet.getRange(existingRow, c + 1).setValue(values[c]);
      }
    } else {
      sheet.appendRow(values.map(function (v) { return v === null ? '' : v; }));
    }

    return json_({
      ok: true,
      token: token,
      feedUrl: FEED_BASE + token + '.ics',
      groups: groups,
      updated: existingRow !== -1
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
