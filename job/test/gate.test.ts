import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The admin gate, actually run.
 *
 * adminauth.test.ts checks the pure parts. This one loads the whole of
 * Code.gs into a fake Apps Script — a sheet in memory, a cache, script
 * properties, and a stand-in for Google's tokeninfo endpoint — and puts real
 * requests through it.
 *
 * It is worth the machinery because of what the failure looks like. A mistake
 * anywhere in here does not produce a wrong answer on a web page; it locks
 * every leader out of the church's calendar, from a building with no computer
 * in it, with the fix sitting behind the very page nobody can open.
 */
const CODE = readFileSync(new URL('../../site/apps-script/Code.gs', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// a sheet, in memory
// ---------------------------------------------------------------------------

class FakeSheet {
  rows: unknown[][] = [];
  getLastRow(): number { return this.rows.length; }
  getLastColumn(): number { return this.rows.length ? this.rows[0].length : 0; }
  setFrozenRows(): void {}
  appendRow(row: unknown[]): void { this.rows.push(row.slice()); }
  deleteRow(row: number): void { this.rows.splice(row - 1, 1); }
  deleteRows(from: number, count: number): void { this.rows.splice(from - 1, count); }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const line = sheet.rows[row - 1 + r] || [];
          const cells: unknown[] = [];
          for (let c = 0; c < numCols; c++) cells.push(line[col - 1 + c] ?? '');
          out.push(cells);
        }
        return out;
      },
      setValue(value: unknown) {
        while (sheet.rows.length < row) sheet.rows.push([]);
        sheet.rows[row - 1][col - 1] = value;
      },
      setValues(values: unknown[][]) {
        for (let r = 0; r < values.length; r++) {
          const target = row - 1 + r;
          while (sheet.rows.length <= target) sheet.rows.push([]);
          for (let c = 0; c < values[r].length; c++) {
            sheet.rows[target][col - 1 + c] = values[r][c];
          }
        }
      },
    };
  }
}

class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  getSheetByName(name: string): FakeSheet | null { return this.sheets.get(name) || null; }
  insertSheet(name: string): FakeSheet {
    const sheet = new FakeSheet();
    this.sheets.set(name, sheet);
    return sheet;
  }
}

// ---------------------------------------------------------------------------
// the rest of Apps Script, as far as this file needs it
// ---------------------------------------------------------------------------

type Reply = { json: Record<string, unknown> };
type Body = Record<string, unknown>;

type Script = {
  checkAdmin_: (body: Body, area?: string) => Reply | null;
  caller: () => string;
  callerRole: () => string;
  handleAdminLeaders_: (body: Body) => Reply;
  handleAdminAddLeader_: (body: Body) => Reply;
  handleAdminRemoveLeader_: (body: Body) => Reply;
  handleAdminSetLeader_: (body: Body) => Reply;
  handleAdminRsvps_: (body: Body) => Reply;
  sendRsvpDigest_: (force: boolean) => number;
  handleAdminSlides_: (body: Body) => Reply;
  handleAdminUpload_: (body: Body) => Reply;
  handleRsvp_: (body: Body) => Reply;
  wallSlides_: () => Array<Record<string, string>>;
  handleNotice_: (body: Body) => Reply;
  sameStart_: (a: unknown, b: unknown) => boolean;
  handleConfig_: () => Reply;
  leaders_: () => Array<Record<string, unknown>>;
};

type World = {
  script: Script;
  props: Map<string, string>;
  book: FakeSpreadsheet;
  /** What tokeninfo says about a token, keyed by the token itself. */
  tokens: Map<string, Record<string, unknown>>;
  /** Every email the script asked to send. */
  mail: Array<Record<string, unknown>>;
  /** Every file the script asked GitHub to commit. */
  github: Array<{ url: string; payload: Record<string, unknown> }>;
  log: () => unknown[][];
};

function world(): World {
  const props = new Map<string, string>([
    ['SPREADSHEET_ID', 'test-sheet'],
    ['ADMIN_PASSCODE', 'correct horse battery staple'],
    ['GOOGLE_CLIENT_ID', '123.apps.googleusercontent.com'],
  ]);
  const book = new FakeSpreadsheet();
  const cache = new Map<string, string>();
  const tokens = new Map<string, Record<string, unknown>>();
  const mail: Array<Record<string, unknown>> = [];
  const github: Array<{ url: string; payload: Record<string, unknown> }> = [];

  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null }),
    },
    SpreadsheetApp: {
      openById: () => book,
      getActiveSpreadsheet: () => book,
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cache.get(k) ?? null,
        put: (k: string, v: string) => { cache.set(k, v); },
        remove: (k: string) => { cache.delete(k); },
      }),
    },
    UrlFetchApp: {
      fetch(url: string, options?: { payload?: string }) {
        if (url.includes('api.github.com')) {
          github.push({ url, payload: JSON.parse(String(options?.payload || '{}')) });
          return { getResponseCode: () => 201, getContentText: () => '{}' };
        }
        if (url.includes('events.json')) {
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ events: [{
              uid: 'ev1', start: '2099-09-18T19:00:00', title: 'Fall Festival',
              ministry: 'youth', contact: 'Spencer Welch',
            }] }),
          };
        }
        if (url.includes('ministries.json')) {
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({
              ministries: [
                { id: 'church', name: 'Church-wide', visibility: 'public', calendarId: 'c1' },
                { id: 'youth', name: 'Greater Generation', visibility: 'public', calendarId: 'c2' },
                { id: 'youth-leaders', name: 'Youth Leaders', visibility: 'private', calendarId: 'c3' },
              ],
            }),
          };
        }
        const at = url.indexOf('id_token=');
        const token = at === -1 ? '' : decodeURIComponent(url.slice(at + 'id_token='.length));
        const claims = tokens.get(token);
        return {
          getResponseCode: () => (claims ? 200 : 400),
          getContentText: () => JSON.stringify(claims || { error: 'invalid_token' }),
        };
      },
    },
    Utilities: {
      base64Encode: (v: string) => Buffer.from(String(v)).toString('base64'),
      computeDigest: (_alg: string, v: string) => v,
      DigestAlgorithm: { SHA_256: 'sha256' },
      sleep: () => {},
      // Only the shapes Code.gs actually asks for. The date one matters: it is
      // how a Date read back out of a cell becomes something that can be
      // compared with the text the page sent.
      formatDate: (d: Date, tz: string, pattern: string) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(d);
        const g = (t: string) => parts.find((x) => x.type === t)!.value;
        const date = g('year') + '-' + g('month') + '-' + g('day');
        if (pattern.includes("'T'")) {
          return date + 'T' + g('hour') + ':' + g('minute') + ':' + g('second');
        }
        return date;
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({
        json: JSON.parse(text),
        setMimeType() { return this; },
      }),
    },
    MailApp: {
      sendEmail: (message: Record<string, unknown>) => { mail.push(message); },
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
  };

  // Code.gs is not a module and expects these as bare globals, so it is run
  // with them in scope rather than rewritten to take them as arguments.
  const load = new Function('globals', `
    with (globals) {
      ${CODE}
      // Apps Script runs one request per execution, so anything cached in a
      // global lives for exactly one call and no longer. These tests reuse a
      // single sandbox across many calls, so each entry point clears that
      // state on the way in — otherwise the harness would hold a cache for a
      // lifetime production never gives it, and a row edited straight in the
      // sheet would look invisible when it is not.
      function fresh(fn){
        return function(){ LEADERS_CACHE = null; return fn.apply(null, arguments); };
      }
      return {
        checkAdmin_: fresh(checkAdmin_),
        caller: function(){ return CALLER; },
        callerRole: function(){ return CALLER_ROLE; },
        handleAdminLeaders_: fresh(handleAdminLeaders_),
        handleAdminAddLeader_: fresh(handleAdminAddLeader_),
        handleAdminRemoveLeader_: fresh(handleAdminRemoveLeader_),
        handleAdminSetLeader_: fresh(handleAdminSetLeader_),
        handleAdminRsvps_: fresh(handleAdminRsvps_),
        sendRsvpDigest_: fresh(sendRsvpDigest_),
        handleAdminSlides_: fresh(handleAdminSlides_),
        handleAdminUpload_: fresh(handleAdminUpload_),
        handleRsvp_: fresh(handleRsvp_),
        wallSlides_: fresh(wallSlides_),
        handleNotice_: fresh(handleNotice_),
        sameStart_: sameStart_,
        handleConfig_: handleConfig_,
        leaders_: fresh(leaders_)
      };
    }
  `) as (g: unknown) => Script;

  const script = load(globals);
  return {
    script, props, book, tokens, mail, github,
    log: () => (book.getSheetByName('Admin log')?.rows.slice(1) ?? []),
  };
}

/** A token Google would vouch for, unless told otherwise. */
function issue(w: World, token: string, claims: Record<string, unknown> = {}): void {
  w.tokens.set(token, {
    aud: '123.apps.googleusercontent.com',
    email: 'andrea@gmail.com',
    email_verified: 'true',
    name: 'Andrea Hutchins',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    ...claims,
  });
}

function addLeader(
  w: World, name: string, email: string,
  role?: string, ministries?: string,
): Reply {
  return w.script.handleAdminAddLeader_({
    action: 'admin.addleader',
    passcode: 'correct horse battery staple',
    name, email, role, ministries,
  });
}

/** Sign somebody in and ask whether they may reach one part of the page. */
function may(w: World, token: string, area: string): boolean {
  return w.script.checkAdmin_({ action: 'admin.' + area, idToken: token }, area) === null;
}

// ---------------------------------------------------------------------------

test('a leader on the list gets in, under their own name', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
  issue(w, 'good');

  const refused = w.script.checkAdmin_({ action: 'admin.save', idToken: 'good' });
  assert.equal(refused, null, 'a leader should be let through');
  assert.equal(w.script.caller(), 'Andrea Hutchins');

  const logged = w.log();
  assert.equal(logged.length, 2, 'the add and the save');
  // The level is on the line too: two refusals that differ only by level
  // would otherwise read identically.
  assert.equal(logged[1][1], 'Andrea Hutchins (leader)');
  assert.equal(logged[1][2], 'admin.save');
});

test('a valid Google account that is not on the list gets nothing', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
  issue(w, 'stranger', { email: 'somebody@else.com', name: 'Somebody Else' });

  const out = w.script.checkAdmin_({ action: 'admin.people', idToken: 'stranger' });
  assert.ok(out, 'a stranger must be refused');
  assert.equal(out!.json.ok, false);
  assert.match(String(out!.json.error), /not on the leaders list/);

  // Refusals are logged whatever the action, including reads.
  const last = w.log().at(-1)!;
  assert.equal(last[1], 'somebody@else.com');
  assert.match(String(last[3]), /refused/);
});

test('a token minted for another site is refused', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
  // Everything about it is real except who asked for it. Without the aud
  // check, any site could collect this from its own visitors and replay it.
  issue(w, 'replayed', { aud: '999.apps.googleusercontent.com' });

  const out = w.script.checkAdmin_({ action: 'admin.save', idToken: 'replayed' });
  assert.ok(out);
  assert.equal(out!.json.ok, false);
  assert.equal(out!.json.needsSignIn, true);
});

test('an expired or unverified token is refused', () => {
  for (const claims of [
    { exp: String(Math.floor(Date.now() / 1000) - 60) },
    { email_verified: 'false' },
    { email: '' },
  ]) {
    const w = world();
    addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
    issue(w, 'dodgy', claims);
    const out = w.script.checkAdmin_({ action: 'admin.save', idToken: 'dodgy' });
    assert.ok(out, JSON.stringify(claims) + ' should be refused');
    assert.equal(out!.json.ok, false);
  }
});

test('the address is matched however the sheet spells it', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'Andrea.Hutchins+church@gmail.com');
  issue(w, 'good', { email: 'andreahutchins@gmail.com' });
  assert.equal(w.script.checkAdmin_({ action: 'admin.hello', idToken: 'good' }), null);
});

test('a leader switched off in the sheet is out', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
  const tab = w.book.getSheetByName('Leaders')!;
  tab.rows[1][2] = 'no';
  issue(w, 'good');
  const out = w.script.checkAdmin_({ action: 'admin.save', idToken: 'good' });
  assert.ok(out, 'switching somebody off has to actually stop them');
});

test('the passcode works until it is switched off, then it does not', () => {
  const w = world();
  assert.equal(w.script.checkAdmin_({
    action: 'admin.save', passcode: 'correct horse battery staple',
  }), null);
  assert.equal(w.script.caller(), 'passcode');

  const wrong = w.script.checkAdmin_({ action: 'admin.save', passcode: 'nope' });
  assert.ok(wrong);
  assert.equal(wrong!.json.ok, false);

  w.props.set('REQUIRE_SIGNIN', 'yes');
  const shut = w.script.checkAdmin_({
    action: 'admin.save', passcode: 'correct horse battery staple',
  });
  assert.ok(shut, 'the right passcode must stop working once sign-in is required');
  assert.equal(shut!.json.needsSignIn, true);

  // And the escape hatch has to actually bring it back.
  w.props.set('REQUIRE_SIGNIN', 'no');
  assert.equal(w.script.checkAdmin_({
    action: 'admin.save', passcode: 'correct horse battery staple',
  }), null);
});

test('the last leader cannot be removed', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com');
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');

  const first = w.script.handleAdminRemoveLeader_({
    action: 'admin.removeleader', passcode: 'correct horse battery staple',
    email: 'andrea@gmail.com',
  });
  assert.equal(first.json.ok, true);

  const last = w.script.handleAdminRemoveLeader_({
    action: 'admin.removeleader', passcode: 'correct horse battery staple',
    email: 'spencerwel2@gmail.com',
  });
  assert.equal(last.json.ok, false, 'emptying the list is a lockout');
  assert.match(String(last.json.error), /last leader/);
});

test('somebody cannot be added twice under a different spelling', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea.hutchins@gmail.com');
  const again = w.script.handleAdminAddLeader_({
    action: 'admin.addleader', passcode: 'correct horse battery staple',
    name: 'A Hutchins', email: 'AndreaHutchins@googlemail.com',
  });
  assert.equal(again.json.ok, false);
  assert.match(String(again.json.error), /already on the list/);
});

test('the page is told what it needs before anybody has signed in', () => {
  const w = world();
  const cfg = w.script.handleConfig_().json;
  assert.equal(cfg.clientId, '123.apps.googleusercontent.com');
  assert.equal(cfg.signInRequired, false);
  assert.equal(cfg.passcodeSet, true);

  // No client id set yet is the state every church starts in, and the page
  // has to be able to tell.
  w.props.delete('GOOGLE_CLIENT_ID');
  assert.equal(w.script.handleConfig_().json.clientId, '');
});

test('reads are not logged, changes are', () => {
  const w = world();
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com');
  issue(w, 'good');
  const before = w.log().length;

  w.script.checkAdmin_({ action: 'admin.list', idToken: 'good', ministry: 'youth' });
  w.script.checkAdmin_({ action: 'admin.people', idToken: 'good' });
  assert.equal(w.log().length, before, 'looking at things should not fill the log');

  w.script.checkAdmin_({
    action: 'admin.save', idToken: 'good', ministry: 'youth', title: 'Fall Retreat',
  });
  const line = w.log().at(-1)!;
  assert.equal(line[2], 'admin.save');
  assert.match(String(line[3]), /youth/);
  assert.match(String(line[3]), /Fall Retreat/);
});

test('the passcode never reaches the log', () => {
  const w = world();
  w.script.checkAdmin_({
    action: 'admin.save', passcode: 'correct horse battery staple',
    ministry: 'church', title: 'Homecoming',
  });
  const written = JSON.stringify(w.log());
  assert.equal(written.includes('correct horse'), false);
});

test('the log is trimmed from the top rather than growing forever', () => {
  const w = world();
  const tab = w.book.getSheetByName('Admin log') ??
    (() => {
      w.script.checkAdmin_({
        action: 'admin.save', passcode: 'correct horse battery staple', title: 'seed',
      });
      return w.book.getSheetByName('Admin log')!;
    })();

  for (let i = 0; i < 2100; i++) {
    w.script.checkAdmin_({
      action: 'admin.save', passcode: 'correct horse battery staple', title: 'e' + i,
    });
  }
  assert.equal(tab.rows.length, 2001, 'a header and the last 2000 lines');
  assert.equal(tab.rows[0][0], 'when', 'the header must survive the trim');
  assert.match(String(tab.rows.at(-1)![3]), /e2099/);
});

// ---------------------------------------------------------------------------
// levels
// ---------------------------------------------------------------------------

test('each level reaches exactly what it is meant to', () => {
  const w = world();
  const want: Record<string, string[]> = {
    admin:  ['events', 'people', 'notices', 'rsvps', 'leaders'],
    staff:  ['events', 'people', 'notices', 'rsvps'],
    leader: ['events', 'rsvps'],
    viewer: ['rsvps'],
  };
  const areas = ['events', 'people', 'notices', 'rsvps', 'leaders'];

  for (const [role, allowed] of Object.entries(want)) {
    addLeader(w, role + ' person', role + '@gmail.com', role);
    issue(w, 't-' + role, { email: role + '@gmail.com', name: role });
    for (const area of areas) {
      assert.equal(may(w, 't-' + role, area), allowed.includes(area),
        role + ' and ' + area + ' disagree with the table');
    }
  }
});

test('a blank role is the quiet end of the scale, not the loud one', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  // A row typed straight into the sheet, with no role in it.
  w.book.getSheetByName('Leaders')!.appendRow(['Hurried Entry', 'hurried@gmail.com', 'yes']);
  issue(w, 'hurried', { email: 'hurried@gmail.com', name: 'Hurried Entry' });

  assert.equal(may(w, 'hurried', 'events'), true, 'a leader may add events');
  assert.equal(may(w, 'hurried', 'leaders'), false, 'a blank role must not mean admin');
  assert.equal(may(w, 'hurried', 'people'), false);
});

test('a typo in the role is a leader, not a lockout and not a promotion', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  addLeader(w, 'Typo Person', 'typo@gmail.com', 'Adminn');
  issue(w, 'typo', { email: 'typo@gmail.com', name: 'Typo Person' });

  assert.equal(may(w, 'typo', 'events'), true);
  assert.equal(may(w, 'typo', 'leaders'), false);
});

test('the columns roles need are added to a tab that predates them', () => {
  const w = world();
  // The tab as it was before levels existed, with somebody already on it.
  const old = w.book.insertSheet('Leaders');
  old.appendRow(['name', 'email', 'active', 'added', 'notes']);
  old.appendRow(['Spencer Welch', 'spencerwel2@gmail.com', 'yes', new Date(), '']);

  const list = w.script.leaders_();
  assert.equal(list.length, 1);
  // Whoever was already there had every power a moment ago. Demoting them
  // silently would put the only way back behind a page they cannot open.
  assert.equal(list[0].role, 'admin');

  const headers = (old.rows[0] as string[]).map((h) => String(h));
  assert.ok(headers.includes('role'), 'role column was not added');
  assert.ok(headers.includes('ministries'), 'ministries column was not added');
});

test('a leader added after the migration lands in the right columns', () => {
  const w = world();
  const old = w.book.insertSheet('Leaders');
  old.appendRow(['name', 'email', 'active', 'added', 'notes']);
  old.appendRow(['Spencer Welch', 'spencerwel2@gmail.com', 'yes', new Date(), '']);

  // role and ministries are now the last two columns, not the fourth and
  // fifth. Writing a row by position would put the role under "added".
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com', 'staff', 'youth');
  const andrea = w.script.leaders_().find((l) => l.email === 'andrea@gmail.com')!;
  assert.equal(andrea.role, 'staff');
  assert.deepEqual(andrea.scope, ['youth']);
});

// ---------------------------------------------------------------------------
// ministry scope
// ---------------------------------------------------------------------------

test('a scoped leader sees only their own ministries\' replies', () => {
  const w = world();
  addLeader(w, 'Youth Leader', 'youth@gmail.com', 'leader', 'youth, youth-leaders');
  issue(w, 'youth', { email: 'youth@gmail.com', name: 'Youth Leader' });

  const rsvps = w.book.insertSheet('RSVPs');
  rsvps.appendRow(['when', 'eventId', 'starts', 'event', 'ministry',
    'name', 'count', 'phone', 'note', 'contact']);
  rsvps.appendRow([new Date(), 'e1', '', 'Fall Retreat', 'youth', 'A Family', 4, '', '', '']);
  rsvps.appendRow([new Date(), 'e2', '', 'Homecoming', 'church', 'B Family', 6, '', '', '']);

  const out = w.script.handleAdminRsvps_({ action: 'admin.rsvps', idToken: 'youth' });
  const got = out.json.rsvps as Array<Record<string, unknown>>;
  assert.equal(got.length, 1, 'a headcount for another ministry is none of their business');
  assert.equal(got[0].ministry, 'youth');
});

test('no scope means every ministry, which is what everybody had before', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  issue(w, 'all', { email: 'spencerwel2@gmail.com', name: 'Spencer Welch' });

  const rsvps = w.book.insertSheet('RSVPs');
  rsvps.appendRow(['when', 'eventId', 'starts', 'event', 'ministry',
    'name', 'count', 'phone', 'note', 'contact']);
  rsvps.appendRow([new Date(), 'e1', '', 'Fall Retreat', 'youth', 'A Family', 4, '', '', '']);
  rsvps.appendRow([new Date(), 'e2', '', 'Homecoming', 'church', 'B Family', 6, '', '', '']);

  const out = w.script.handleAdminRsvps_({ action: 'admin.rsvps', idToken: 'all' });
  assert.equal((out.json.rsvps as unknown[]).length, 2);
});

test('a scope naming a calendar that does not exist is refused', () => {
  const w = world();
  // Silently accepting this scopes somebody to nothing: they sign in to an
  // empty dropdown with no clue why.
  const out = addLeader(w, 'Fat Finger', 'ff@gmail.com', 'leader', 'yuoth');
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /no calendar called "yuoth"/);
});

// ---------------------------------------------------------------------------
// the list must never run out of admins
// ---------------------------------------------------------------------------

test('the only admin cannot be demoted', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com', 'staff');

  const out = w.script.handleAdminSetLeader_({
    action: 'admin.setleader', passcode: 'correct horse battery staple',
    email: 'spencerwel2@gmail.com', role: 'staff',
  });
  assert.equal(out.json.ok, false, 'staff cannot promote anybody, so this is a dead end');
  assert.match(String(out.json.error), /only admin/);
});

test('the only admin cannot be removed either', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com', 'leader');

  const out = w.script.handleAdminRemoveLeader_({
    action: 'admin.removeleader', passcode: 'correct horse battery staple',
    email: 'spencerwel2@gmail.com',
  });
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /only admin/);
});

test('with a second admin in place, the first may step down', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  addLeader(w, 'Andrea Hutchins', 'andrea@gmail.com', 'admin');

  const out = w.script.handleAdminSetLeader_({
    action: 'admin.setleader', passcode: 'correct horse battery staple',
    email: 'spencerwel2@gmail.com', role: 'leader',
  });
  assert.equal(out.json.ok, true);
  const spencer = w.script.leaders_().find((l) => l.email === 'spencerwel2@gmail.com')!;
  assert.equal(spencer.role, 'leader');
});

test('the passcode carries every level, since it carries no name', () => {
  const w = world();
  assert.equal(w.script.checkAdmin_({
    action: 'admin.addleader', passcode: 'correct horse battery staple',
  }, 'leaders'), null);
  assert.equal(w.script.callerRole(), 'admin');
});

test('a refusal for the wrong level is logged, and says which level', () => {
  const w = world();
  addLeader(w, 'Spencer Welch', 'spencerwel2@gmail.com', 'admin');
  addLeader(w, 'Viewer Person', 'viewer@gmail.com', 'viewer');
  issue(w, 'viewer', { email: 'viewer@gmail.com', name: 'Viewer Person' });

  w.script.checkAdmin_({ action: 'admin.save', idToken: 'viewer' }, 'events');
  const line = w.log().at(-1)!;
  assert.match(String(line[1]), /Viewer Person \(viewer\)/);
  assert.match(String(line[3]), /may not reach events/);
});

// ---------------------------------------------------------------------------
// the RSVP digest
// ---------------------------------------------------------------------------

test('the digest measures from its last run, not from the calendar date', () => {
  // The bug this replaced: "changed" meant "recorded today", and the trigger
  // fires at 7am. At that hour almost nothing has been recorded today — the
  // replies needing a headcount came in yesterday afternoon, and by 7am they
  // no longer matched. An RSVP was only ever reported if somebody filled the
  // form in between midnight and seven, so in practice no email ever went.
  const code = readFileSync(
    new URL('../../site/apps-script/Code.gs', import.meta.url), 'utf8');

  assert.equal(code.includes('todayKey_'), false,
    'the digest is back to comparing calendar dates');
  // Read by column name now, but the rule is the same one: newer than the
  // last run, not "recorded on todays date".
  assert.ok(code.includes("rsvpCell_(rows[i], headers, 'when')"),
    'the digest reads the timestamp by position again');
  assert.ok(code.includes('new Date(at) > since'),
    'the digest no longer measures from its last run');
  assert.ok(code.includes("props.setProperty(DIGEST_MARK, now.toISOString())"),
    'the run is not recorded, so the next one has no window to measure');

  // A button press sends the list as it stands. Moving the mark as well would
  // swallow the window the next scheduled run measures, so the replies that
  // arrived in between would never be reported.
  assert.ok(code.includes('if (!force) props.setProperty(DIGEST_MARK'),
    'a manual send must not move the mark');
});

test('every silent way the digest can fail is reported somewhere', () => {
  // A trigger that was never created, a contact who does not match the
  // Contacts tab, a Contacts row with no address: each ends in nobody
  // receiving anything and none of them says so.
  const code = readFileSync(
    new URL('../../site/apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(code.includes('function rsvpHealth_'));
  for (const field of ['digestTrigger', 'rows', 'contacts', 'reachable', 'lastRun']) {
    assert.ok(code.includes(field + ':'), 'the health check does not report ' + field);
  }
  assert.ok(code.includes('rsvps: rsvpHealth_()'), 'it is not wired into doGet');
});

// ---------------------------------------------------------------------------
// answering twice
// ---------------------------------------------------------------------------

/** Seed an RSVPs tab, in the order the sheet would hold the rows. */
function seedRsvps(w: World, rows: unknown[][]): void {
  const tab = w.book.insertSheet('RSVPs');
  tab.appendRow(['when', 'eventId', 'starts', 'event', 'ministry',
    'name', 'count', 'phone', 'note', 'contact']);
  rows.forEach((r) => tab.appendRow(r));
}

test('a start time matches whether the cell kept it as text or as a date', () => {
  const w = world();
  // The cause of the duplicate rows. The page sends text; Sheets turns
  // anything shaped like that into a date value, so comparing the two as
  // strings never matched and every answer appended a new row.
  const asDate = new Date('2026-09-18T19:00:00-04:00');
  assert.equal(w.script.sameStart_(asDate, '2026-09-18T19:00:00'), true);
  assert.equal(w.script.sameStart_('2026-09-18T19:00:00', '2026-09-18T19:00:00'), true);

  // An all-day event carries a date with no time, and the cell holds midnight.
  assert.equal(w.script.sameStart_(new Date('2026-09-18T00:00:00-04:00'), '2026-09-18'), true);

  // Different occurrences of the same series must stay apart.
  assert.equal(w.script.sameStart_(asDate, '2026-09-19T19:00:00'), false);
  assert.equal(w.script.sameStart_(asDate, ''), false);
});

test('somebody who answered twice is one family, not two', () => {
  const w = world();
  // The state Spencer's sheet was in: the same person, the same event, three
  // attempts, because the replacement never matched.
  seedRsvps(w, [
    [new Date('2026-09-01T12:00:00Z'), 'ev1', '2026-09-18T19:00:00', 'Youth Revival',
      'youth', 'Spencer Welch', 2, '', '', 'Spencer Welch'],
    [new Date('2026-09-10T23:00:00Z'), 'ev1', '2026-09-18T19:00:00', 'Youth Revival',
      'youth', 'Spencer Welch', 4, '555-1234', '', 'Spencer Welch'],
    [new Date('2026-09-10T23:05:00Z'), 'ev1', '2026-09-18T19:00:00', 'Youth Revival',
      'youth', 'spencer welch', 4, '555-1234', '', 'Spencer Welch'],
    [new Date('2026-09-10T23:10:00Z'), 'ev1', '2026-09-18T19:00:00', 'Youth Revival',
      'youth', 'Andrea Hutchins', 3, '', '', 'Spencer Welch'],
  ]);

  const out = w.script.handleAdminRsvps_({
    action: 'admin.rsvps', passcode: 'correct horse battery staple',
  });
  const list = out.json.rsvps as Array<Record<string, unknown>>;
  assert.equal(list.length, 2, 'one row each for two families');
  const spencer = list.find((r) => String(r.name).toLowerCase() === 'spencer welch')!;
  assert.equal(spencer.count, 4, 'the latest answer is the one that counts');
});

test('the headcount emailed is the headcount, not the number of attempts', () => {
  const w = world();
  const contacts = w.book.insertSheet('Contacts');
  contacts.appendRow(['name', 'email', 'active']);
  contacts.appendRow(['Spencer Welch', 'spencerwel2@gmail.com', 'yes']);

  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  seedRsvps(w, [
    [new Date(), 'ev1', future, 'Youth Revival', 'youth', 'Spencer Welch', 2, '', '', 'Spencer Welch'],
    [new Date(), 'ev1', future, 'Youth Revival', 'youth', 'Spencer Welch', 4, '', '', 'Spencer Welch'],
    [new Date(), 'ev1', future, 'Youth Revival', 'youth', 'Andrea Hutchins', 3, '', '', 'Spencer Welch'],
  ]);

  const sent = w.script.sendRsvpDigest_(true);
  assert.equal(sent, 1, 'one contact, one email');
  const body = String(w.mail[0].body);

  // Two and four are the same family twice. Cooking for nine would be wrong.
  assert.match(body, /7 coming, 2 responses/);
  assert.equal(body.includes('Spencer Welch — 2'), false, 'the replaced answer is still listed');
  assert.ok(body.includes('Spencer Welch — 4'));
  assert.ok(body.includes('Andrea Hutchins — 3'));
});

// ---------------------------------------------------------------------------
// standing slides
// ---------------------------------------------------------------------------

const PASS = { passcode: 'correct horse battery staple' };

function saveSlides(w: World, slides: unknown[], slideEvery?: number): Reply {
  return w.script.handleAdminSlides_({
    action: 'admin.slides', ...PASS, slides, slideEvery,
  });
}

test('slides come back in the order they were saved', () => {
  const w = world();
  assert.deepEqual(
    w.script.handleAdminSlides_({ action: 'admin.slides', ...PASS, read: true }).json.slides,
    [],
    'a church that has never set one should see an empty list, not an error');

  const out = saveSlides(w, [
    { title: 'Interested in serving?', body: 'Greeter: Tim & Vivian Wiggs\nMusic: Nelson Tomlinson' },
    { title: 'Giving', body: 'In the box at the back, or online.' },
  ], 3);

  const slides = out.json.slides as Array<Record<string, string>>;
  assert.equal(slides.length, 2);
  assert.equal(slides[0].title, 'Interested in serving?');
  assert.equal(slides[1].title, 'Giving');
  // Order is the whole point: it decides which one comes up next.
  assert.match(slides[0].body, /Greeter/);
});

test('saving replaces the lot, so removing one removes it', () => {
  const w = world();
  saveSlides(w, [{ title: 'One', body: 'a' }, { title: 'Two', body: 'b' }]);
  const out = saveSlides(w, [{ title: 'Two', body: 'b' }]);
  const slides = out.json.slides as Array<Record<string, string>>;
  assert.equal(slides.length, 1);
  assert.equal(slides[0].title, 'Two');
});

test('a row somebody added and thought better of is dropped, not refused', () => {
  const w = world();
  const out = saveSlides(w, [
    { title: 'Real', body: 'something' },
    { title: '', body: '' },
  ]);
  assert.equal(out.json.ok, true, 'an empty row must not block the save');
  assert.equal((out.json.slides as unknown[]).length, 1);
});

test('a slide longer than a wall can hold is refused', () => {
  const w = world();
  const out = saveSlides(w, [{ title: 'Long', body: 'x'.repeat(601) }]);
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /Split it in two/);
});

test('a slide switched off in the sheet stays off the wall', () => {
  const w = world();
  saveSlides(w, [{ title: 'On', body: 'a' }, { title: 'Off', body: 'b' }]);
  const tab = w.book.getSheetByName('Slides')!;
  // By name, not position: the tab gained an image and an end date after it
  // was created, so which column "active" is depends on when the sheet was made.
  const active = (tab.rows[0] as string[]).indexOf("active");
  assert.notEqual(active, -1, "the Slides tab has no active column");
  tab.rows[2][active] = "no";
  const slides = w.script.handleAdminSlides_({
    action: 'admin.slides', ...PASS, read: true,
  }).json.slides as Array<Record<string, string>>;
  assert.equal(slides.length, 1);
  assert.equal(slides[0].title, 'On');
});

test('the wall is told the slides on the poll it already makes', () => {
  const w = world();
  saveSlides(w, [{ title: 'Serving', body: 'Parking Lot: James Cullefer' }], 4);

  // No sign-in on this action: it is what the TV itself calls, and what it
  // returns is already on a screen in the foyer.
  const out = w.script.handleNotice_({ action: 'notice' });
  assert.equal(out.json.ok, true);
  assert.equal((out.json.slides as unknown[]).length, 1);
  assert.equal(out.json.slideEvery, 4);
});

test('the rhythm defaults to three and refuses nonsense', () => {
  const w = world();
  assert.equal(w.script.handleNotice_({ action: 'notice' }).json.slideEvery, 3);

  for (const bad of [0, -1, 21, 'soon']) {
    const out = saveSlides(w, [{ title: 'A', body: 'b' }], bad as number);
    assert.equal(out.json.ok, false, String(bad) + ' should be refused');
  }

  assert.equal(saveSlides(w, [{ title: 'A', body: 'b' }], 5).json.slideEvery, 5);
});

// ---------------------------------------------------------------------------
// pictures on slides, and slides that expire
// ---------------------------------------------------------------------------

/** A one pixel PNG, as a browser would hand it over. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a slide can be a picture with nothing written on it', () => {
  const w = world();
  const out = saveSlides(w, [{ title: '', body: '', image: 'https://example.org/flyer.png' }]);
  assert.equal(out.json.ok, true);
  const slides = out.json.slides as Array<Record<string, string>>;
  assert.equal(slides.length, 1, 'a picture on its own is a slide, not an empty row');
  assert.equal(slides[0].image, 'https://example.org/flyer.png');
});

test('an end date takes a slide off the wall, and only off the wall', () => {
  const w = world();
  const yesterday = '2000-01-01';
  const far = '2999-12-31';
  saveSlides(w, [
    { title: 'Over', body: 'a', until: yesterday },
    { title: 'Still on', body: 'b', until: far },
    { title: 'Forever', body: 'c' },
  ]);

  // The wall drops the expired one...
  const wall = w.script.wallSlides_();
  assert.deepEqual(wall.map((s) => s.title), ['Still on', 'Forever']);
  // ...and it carries no end date, which is not the wall's business.
  assert.equal('until' in wall[0], false);

  // ...but the admin page still sees it, or it could never be edited or removed.
  const edit = w.script.handleAdminSlides_({ action: 'admin.slides', ...PASS, read: true });
  assert.equal((edit.json.slides as unknown[]).length, 3);
});

test('a date that is not a date is refused rather than ignored', () => {
  const w = world();
  const out = saveSlides(w, [{ title: 'A', body: 'b', until: 'next Easter' }]);
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /does not look like a date/);
});

test('a tab made before pictures existed gains the columns and files them right', () => {
  const w = world();
  // The Slides tab as it was a day earlier.
  const old = w.book.insertSheet('Slides');
  old.appendRow(['title', 'body', 'active']);
  old.appendRow(['Serving', 'Greeters', 'yes']);

  saveSlides(w, [
    { title: 'Serving', body: 'Greeters' },
    { title: 'Giving', body: 'In the box', image: 'https://example.org/qr.svg', until: '2999-01-01' },
  ]);

  // The new columns are appended on the end, so writing a row by fixed
  // position would file the end date under "active" and switch the slide off.
  const headers = (old.rows[0] as string[]).map(String);
  assert.ok(headers.includes('image') && headers.includes('until'));

  const back = w.script.handleAdminSlides_({ action: 'admin.slides', ...PASS, read: true })
    .json.slides as Array<Record<string, string>>;
  assert.equal(back[1].image, 'https://example.org/qr.svg');
  assert.equal(back[1].until, '2999-01-01');
  assert.equal(back[1].title, 'Giving');
  assert.equal(w.script.wallSlides_().length, 2, 'neither should have been switched off');
});

// ---------------------------------------------------------------------------
// uploading
// ---------------------------------------------------------------------------

test('an uploaded picture is committed to the site and served from it', () => {
  const w = world();
  w.props.set('GITHUB_REPO', 'greaterlifebaptist/calendar');
  w.props.set('GITHUB_DISPATCH_TOKEN', 'tok');

  const out = w.script.handleAdminUpload_({
    action: 'admin.upload', ...PASS, name: 'Donate QR.png', dataUrl: PIXEL,
  });

  assert.equal(out.json.ok, true, String(out.json.error || ''));
  assert.equal(w.github.length, 1);
  // Under site/, because that is what the publish workflow watches.
  assert.match(w.github[0].url, /contents\/site\/img\/slides\//);
  assert.match(String(out.json.url), /^https:\/\/calendars\..+\/img\/slides\/.+-donate-qr\.png$/);
  // The bytes, not the data: URL wrapper.
  assert.equal(String(w.github[0].payload.content).startsWith('data:'), false);
});

test('only a picture, and only a reasonable one', () => {
  const w = world();
  w.props.set('GITHUB_REPO', 'greaterlifebaptist/calendar');
  w.props.set('GITHUB_DISPATCH_TOKEN', 'tok');

  const notAnImage = w.script.handleAdminUpload_({
    action: 'admin.upload', ...PASS, name: 'notes.txt', dataUrl: 'data:text/plain;base64,aGk=',
  });
  assert.equal(notAnImage.json.ok, false);
  assert.match(String(notAnImage.json.error), /PNG, JPG/);

  const nonsense = w.script.handleAdminUpload_({
    action: 'admin.upload', ...PASS, name: 'x', dataUrl: 'hello',
  });
  assert.equal(nonsense.json.ok, false);

  // Base64 carries three bytes in four characters, so exactly 2MB of it is
  // exactly the 1.5MB limit and is allowed. This one is comfortably over.
  const huge = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);
  const tooBig = w.script.handleAdminUpload_({
    action: 'admin.upload', ...PASS, name: 'photo.png', dataUrl: huge,
  });
  assert.equal(tooBig.json.ok, false);
  assert.match(String(tooBig.json.error), /under 1.5MB/);

  assert.equal(w.github.length, 0, 'nothing refused should have been committed');
});

test('uploading says so plainly when it was never set up', () => {
  const w = world();
  w.props.delete('GITHUB_REPO');
  const out = w.script.handleAdminUpload_({
    action: 'admin.upload', ...PASS, name: 'a.png', dataUrl: PIXEL,
  });
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /not set up/);
});

// ---------------------------------------------------------------------------
// how many adults, how many children
// ---------------------------------------------------------------------------

const EVENT = { eventId: 'ev1', starts: '2099-09-18T19:00:00' };

function rsvp(w: World, answer: Record<string, unknown>): Reply {
  return w.script.handleRsvp_({ action: 'rsvp', ...EVENT, ...answer });
}

function onlyRow(w: World): Record<string, unknown> {
  const list = w.script.handleAdminRsvps_({ action: 'admin.rsvps', ...PASS })
    .json.rsvps as Array<Record<string, unknown>>;
  assert.equal(list.length, 1, 'expected exactly one response');
  return list[0];
}

test('the total is what rules, and it is the two added up', () => {
  const w = world();
  assert.equal(rsvp(w, { name: 'Spencer Welch', adults: 2, children: 3 }).json.ok, true);
  const row = onlyRow(w);
  assert.equal(row.count, 5, 'the total is what every tally already reads');
  assert.equal(row.adults, 2);
  assert.equal(row.children, 3);
});

test('children is not a required box', () => {
  const w = world();
  assert.equal(rsvp(w, { name: 'Just Me', adults: 1 }).json.ok, true);
  const row = onlyRow(w);
  assert.equal(row.count, 1);
  assert.equal(row.children, 0);
});

test('a parent sending children and not staying is an ordinary answer', () => {
  // The reason the total is what must reach one, rather than the adults.
  const w = world();
  assert.equal(rsvp(w, { name: 'Dropping Off', adults: 0, children: 2 }).json.ok, true);
  const row = onlyRow(w);
  assert.equal(row.count, 2);
  assert.equal(row.adults, 0);
  assert.equal(row.children, 2);
});

test('nobody at all is still refused', () => {
  const w = world();
  const out = rsvp(w, { name: 'Nobody', adults: 0, children: 0 });
  assert.equal(out.json.ok, false);
  assert.match(String(out.json.error), /How many are coming/);
});

test('a page that only knows how to send a total is still accepted', () => {
  // The site and the endpoint deploy separately, so there is always a window
  // where one is newer. An RSVP lost in it is a family who think they replied.
  const w = world();
  assert.equal(rsvp(w, { name: 'Old Page', count: 4 }).json.ok, true);
  const row = onlyRow(w);
  assert.equal(row.count, 4);
  // And it must not come back claiming they brought no children.
  assert.equal('adults' in row, false);
  assert.equal('children' in row, false);
});

test('answering again replaces the split as well as the number', () => {
  const w = world();
  rsvp(w, { name: 'Spencer Welch', adults: 2, children: 2 });
  const second = rsvp(w, { name: 'spencer welch', adults: 2, children: 0 });
  assert.equal(second.json.updated, true, 'it should have replaced, not added');
  const row = onlyRow(w);
  assert.equal(row.count, 2);
  assert.equal(row.children, 0);
});

test('the split is written to the right columns on a tab that predates it', () => {
  const w = world();
  // The RSVPs tab as every church already has it.
  const old = w.book.insertSheet('RSVPs');
  old.appendRow(['when', 'eventId', 'starts', 'event', 'ministry',
    'name', 'count', 'phone', 'note', 'contact']);

  rsvp(w, { name: 'Spencer Welch', adults: 2, children: 3, phone: '555' });

  const headers = (old.rows[0] as string[]).map(String);
  assert.ok(headers.includes('adults') && headers.includes('children'));
  const row = onlyRow(w);
  // Written by name: a fixed order would have put the adults under "contact".
  assert.equal(row.adults, 2);
  assert.equal(row.children, 3);
  assert.equal(row.contact, 'Spencer Welch');
  assert.equal(row.phone, '555');
});

test('the email adds the split up only when every answer said', () => {
  const w = world();
  const contacts = w.book.insertSheet('Contacts');
  contacts.appendRow(['name', 'email', 'active']);
  contacts.appendRow(['Spencer Welch', 'spencerwel2@gmail.com', 'yes']);

  rsvp(w, { name: 'A Family', adults: 2, children: 2 });
  rsvp(w, { name: 'B Family', adults: 1, children: 0 });

  w.script.sendRsvpDigest_(true);
  let body = String(w.mail[0].body);
  assert.match(body, /5 coming \(3 adults, 2 children\), 2 responses/);
  assert.match(body, /A Family — 4 \(2 adults, 2 children\)/);
  assert.match(body, /B Family — 1 \(1 adult\)/);

  // Now one answer with no split at all. Printing "5 coming (3 adults, 2
  // children)" beside a total of eight would read as a miscount rather than
  // as missing information, so the breakdown is dropped from the total.
  rsvp(w, { name: 'C Family', count: 3 });
  w.mail.length = 0;
  w.script.sendRsvpDigest_(true);
  body = String(w.mail[0].body);
  assert.match(body, /8 coming, 3 responses/);
  assert.equal(/8 coming \(/.test(body), false);
  // The ones that did say still say so on their own line.
  assert.match(body, /A Family — 4 \(2 adults, 2 children\)/);
  assert.match(body, /C Family — 3\n/);
});
