import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The admin page's own script, checked for the things a bulk edit can break.
 *
 * These exist because of a real one. Rewriting every `passcode: PASS` in the
 * file to `...auth()` also rewrote the inside of `auth()` itself, which made it
 * call itself forever. The page then reported that as "could not reach the
 * church server", so the hunt started at the network and the endpoint, both of
 * which were fine.
 *
 * Assertions here say what is missing rather than matching against the whole
 * script: a failed regex on a 78KB file prints the file.
 */
const PAGE = readFileSync(new URL('../../site/admin.html', import.meta.url), 'utf8');

const SCRIPT = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).join('\n');

function has(needle: string, why: string): void {
  assert.ok(SCRIPT.includes(needle), why + ' — expected to find: ' + needle);
}

test('the page has an inline script and it parses', () => {
  assert.ok(SCRIPT.length > 1000, 'the script block is missing or empty');
  // A syntax error here ships a page that does nothing at all. Top-level
  // await is legal in the page and not in a Function body, so it is neutered
  // for the parse rather than the page being changed to suit the test.
  new Function(SCRIPT.replace(/\bawait\b/g, 'void'));
});

test('auth() hands over a credential rather than calling itself', () => {
  const at = SCRIPT.indexOf('function auth(');
  assert.notEqual(at, -1, 'auth() is gone');
  // A window rather than a brace walk: the first `}` after the signature is
  // the one closing the object it returns, not the function.
  const body = SCRIPT.slice(at, at + 200);

  assert.ok(body.includes('idToken: IDTOKEN'), 'auth() no longer offers the sign-in token');
  assert.ok(body.includes('passcode: PASS'), 'auth() no longer offers the passcode');
  assert.equal(body.includes('auth()', 'function auth('.length), false,
    'auth() calls itself, which hangs the page: ' + body);
});

test('every admin call to the endpoint carries a credential', () => {
  const calls = [...SCRIPT.matchAll(/action:\s*"(admin\.[a-z]+|contacts|card\.mail)"([\s\S]{0,220})/g)];
  assert.ok(calls.length >= 15, 'expected the admin actions, found ' + calls.length);

  for (const m of calls) {
    assert.ok(m[2].includes('...auth()'),
      m[1] + ' is called without a credential, so only that button would fail');
  }
});

test('the one unauthenticated call is the one that asks what is needed', () => {
  // config runs before anybody has said who they are, by design.
  has('call({ action:"config" })', 'the page no longer asks which doors exist');
});

test('a fault in the page is not reported as a connection problem', () => {
  // The message that sent the last hunt to the wrong place is now reserved
  // for an actual failure to reach the server.
  has('err.offline = true', 'a real network failure is no longer marked as one');
  has('if (err && err.offline)', 'fail() no longer distinguishes the connection');
  has('Something went wrong in this page',
    'a fault in the page has gone back to blaming the connection');
});

test('the sign-in flow keeps its two ways out', () => {
  // Neither of these is reachable by clicking through in a test, and both are
  // the difference between an inconvenience and a lockout.
  has('window.onGoogleLibraryLoad = drawSignIn',
    'a late-loading Google library would leave an empty box where the button goes');
  has('function signInUnavailable',
    'a blocked Google library would leave no way in at all');
});

test('the page never asks for an endpoint version that does not exist yet', () => {
  // The two halves ship differently — the site on a push, the endpoint by
  // hand — so the page tells the reader when the endpoint is behind it. That
  // warning is only useful while the version it names is one that has been
  // written; asking for a future one would nag forever with no fix available.
  const needs = /const NEEDS_ENDPOINT = "([^"]+)"/.exec(SCRIPT);
  assert.ok(needs, 'the page no longer states which endpoint it needs');

  const code = readFileSync(
    new URL('../../site/apps-script/Code.gs', import.meta.url), 'utf8');
  const shipped = /var VERSION = '([^']+)'/.exec(code);
  assert.ok(shipped, 'Code.gs has no version marker');

  assert.ok(needs![1] <= shipped![1],
    'the page wants endpoint ' + needs![1] + ' but Code.gs is only ' + shipped![1]);

  // Both are datestamps, which is what makes comparing them as text correct.
  for (const v of [needs![1], shipped![1]]) {
    assert.match(v, /^\d{4}-\d{2}-\d{2}[a-z]?$/, v + ' is not a datestamp');
  }
});
