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
  handleConfig_: () => Reply;
  leaders_: () => Array<Record<string, unknown>>;
};

type World = {
  script: Script;
  props: Map<string, string>;
  book: FakeSpreadsheet;
  /** What tokeninfo says about a token, keyed by the token itself. */
  tokens: Map<string, Record<string, unknown>>;
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
      fetch(url: string) {
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
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({
        json: JSON.parse(text),
        setMimeType() { return this; },
      }),
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
        handleConfig_: handleConfig_,
        leaders_: fresh(leaders_)
      };
    }
  `) as (g: unknown) => Script;

  const script = load(globals);
  return {
    script, props, book, tokens,
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
  assert.ok(code.includes('new Date(rows[i][0]) > since'),
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
