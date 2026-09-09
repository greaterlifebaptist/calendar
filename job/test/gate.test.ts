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

type Script = {
  checkAdmin_: (body: Record<string, unknown>) => { json: Record<string, unknown> } | null;
  caller: () => string;
  handleAdminLeaders_: (body: Record<string, unknown>) => { json: Record<string, unknown> };
  handleAdminAddLeader_: (body: Record<string, unknown>) => { json: Record<string, unknown> };
  handleAdminRemoveLeader_: (body: Record<string, unknown>) => { json: Record<string, unknown> };
  handleConfig_: () => { json: Record<string, unknown> };
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
      return {
        checkAdmin_: checkAdmin_,
        caller: function(){ return CALLER; },
        handleAdminLeaders_: handleAdminLeaders_,
        handleAdminAddLeader_: handleAdminAddLeader_,
        handleAdminRemoveLeader_: handleAdminRemoveLeader_,
        handleConfig_: handleConfig_
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

function addLeader(w: World, name: string, email: string): void {
  w.script.handleAdminAddLeader_({
    action: 'admin.addleader',
    passcode: 'correct horse battery staple',
    name, email,
  });
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
  assert.equal(logged[1][1], 'Andrea Hutchins');
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
