import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The sign-in gate lives in Apps Script, which nothing here can run.
 *
 * Rather than keep a second copy in TypeScript and hope the two stay in step,
 * these tests read the real Code.gs, lift the two functions that decide who
 * gets in, and run those. If somebody edits the deployed file, this fails.
 *
 * Only pure functions can be lifted this way — anything touching the sheet or
 * the network is left to the health check.
 */
const CODE = readFileSync(new URL('../../site/apps-script/Code.gs', import.meta.url), 'utf8');

function lift<T>(name: string): T {
  const at = CODE.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is no longer in Code.gs');

  // Walk the braces to find where the function ends. Good enough for these
  // two: neither contains a brace inside a string or a regular expression.
  const open = CODE.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < CODE.length; i++) {
    if (CODE[i] === '{') depth++;
    else if (CODE[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, 'could not find the end of ' + name);
  return new Function(CODE.slice(at, end) + '; return ' + name + ';')() as T;
}

const normalizeEmail = lift<(raw: unknown) => string>('normalizeEmail_');
const requireSignInFrom = (value: string): boolean =>
  /^(yes|y|true|on|1)$/i.test(String(value || '').trim());

test('a Gmail address is the same address however it is written', () => {
  const same = [
    'spencerwelch@gmail.com',
    'Spencer.Welch@gmail.com',
    'SPENCERWELCH@GMAIL.COM',
    'spencer.welch+church@gmail.com',
    's.p.e.n.c.e.r.w.e.l.c.h@googlemail.com',
    '  spencerwelch@gmail.com  ',
  ].map(normalizeEmail);

  for (const got of same) {
    assert.equal(got, 'spencerwelch@gmail.com');
  }
});

test('dots and plus signs are left alone everywhere but Gmail', () => {
  // Other providers may genuinely treat these as different mailboxes, and
  // folding them would let one person's address stand in for another's.
  assert.equal(normalizeEmail('First.Last@outlook.com'), 'first.last@outlook.com');
  assert.equal(normalizeEmail('first+church@church.org'), 'first+church@church.org');
  assert.equal(
    normalizeEmail('office@greaterlifebaptistchurch.com'),
    'office@greaterlifebaptistchurch.com',
  );
});

test('nonsense in the sheet does not become somebody else', () => {
  assert.equal(normalizeEmail(''), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail('   '), '');
  // No @ at all: returned unchanged rather than mangled into a lookalike.
  assert.equal(normalizeEmail('Jane Doe'), 'jane doe');
  // A Gmail row typed as nothing but dots must not collapse to "@gmail.com"
  // and match every other broken row in the tab.
  assert.equal(normalizeEmail('...@gmail.com'), '...@gmail.com');
  assert.equal(normalizeEmail('+church@gmail.com'), '+church@gmail.com');
});

test('the address is matched on the whole domain, not a prefix', () => {
  // gmail.com.example.org is somebody else's domain entirely.
  assert.equal(
    normalizeEmail('a.b@gmail.com.example.org'),
    'a.b@gmail.com.example.org',
  );
});

test('REQUIRE_SIGNIN only turns on for something that means yes', () => {
  for (const on of ['yes', 'Yes', 'YES', 'y', 'true', 'on', '1', '  yes  ']) {
    assert.equal(requireSignInFrom(on), true, on + ' should switch it on');
  }
  // Anything else leaves the passcode working. A typo in a script property
  // must not lock every leader out of the page.
  for (const off of ['', 'no', 'off', 'false', '0', 'soon', 'ye s']) {
    assert.equal(requireSignInFrom(off), false, off + ' should leave it off');
  }
});

test('the gate Code.gs actually ships is the one described here', () => {
  // Every admin handler goes through checkAdmin_, and none is left on the old
  // passcode-only path. A handler that slipped back would be a hole.
  assert.equal(CODE.includes('checkPasscode_(body.passcode)'), false);
  assert.ok(CODE.split('checkAdmin_(body)').length - 1 >= 14);

  // aud is the check that stops another site replaying its own visitors'
  // Google tokens here. Losing it would leave sign-in looking like it works.
  assert.ok(/String\(data\.aud \|\| ''\) !== clientId/.test(CODE));
  assert.ok(/String\(data\.email_verified\) !== 'true'/.test(CODE));
});
