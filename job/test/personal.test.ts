import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.ts';
import { normalize } from '../src/normalize.ts';
import { writePersonalFeeds } from '../src/personal.ts';
import { newToken, isValidToken, duplicateTokens } from '../src/sheet.ts';
import type { CalEvent, RawEvent, Person } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;
const NOW = new Date('2026-09-04T12:00:00-04:00');
const OUT = join(tmpdir(), 'glbc-personal-test');

function ev(ministry: string, summary: string, id: string): CalEvent {
  return normalize(
    {
      ministry,
      id,
      iCalUID: id + '@google.com',
      status: 'confirmed',
      summary,
      start: { dateTime: '2026-09-20T19:00:00-04:00' },
      end: { dateTime: '2026-09-20T20:00:00-04:00' },
    } as RawEvent,
    TZ,
    NOW,
  );
}

const MASTERS: CalEvent[] = [
  ev('church', 'Revival night', 'a'),
  ev('youth', 'Youth car wash', 'b'),
  ev('youth-leaders', 'Leaders budget meeting', 'c'),
  ev('mens', 'Mens breakfast', 'd'),
];

function person(patch: Partial<Person>): Person {
  return { name: 'Jane Doe', email: '', token: newToken(), created: '2026-09-04', groups: [], row: 2, ...patch };
}

function reset() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

function feed(token: string): string {
  return readFileSync(join(OUT, 'f', token + '.ics'), 'utf8');
}

test('a personal feed contains exactly the groups that person picked', () => {
  reset();
  const p = person({ groups: ['church', 'youth'] });
  writePersonalFeeds(cfg, [p], MASTERS, OUT);
  const ics = feed(p.token);
  assert.ok(ics.includes('Revival night'));
  assert.ok(ics.includes('Youth car wash'));
  assert.ok(!ics.includes('Mens breakfast'), 'a group they did not pick leaked in');
});

test('private ministries reach a member here and nowhere else', () => {
  reset();
  const leader = person({ name: 'Spencer', groups: ['youth', 'youth-leaders'] });
  const parent = person({ name: 'Parent', groups: ['youth'] });
  writePersonalFeeds(cfg, [leader, parent], MASTERS, OUT);

  assert.ok(feed(leader.token).includes('Leaders budget meeting'));
  assert.ok(
    !feed(parent.token).includes('Leaders budget meeting'),
    'a private ministry reached somebody who is not a member',
  );
});

test('clearing a column drops that content on the next run', () => {
  reset();
  const token = newToken();
  writePersonalFeeds(cfg, [person({ token, groups: ['youth', 'youth-leaders'] })], MASTERS, OUT);
  assert.ok(feed(token).includes('Leaders budget meeting'));

  // Same person, leaders column now empty. This is the revocation mechanism.
  writePersonalFeeds(cfg, [person({ token, groups: ['youth'] })], MASTERS, OUT);
  assert.ok(!feed(token).includes('Leaders budget meeting'));
  assert.ok(feed(token).includes('Youth car wash'), 'their remaining groups should survive');
});

test('removing a row deletes the feed rather than leaving it served', () => {
  reset();
  const gone = person({ token: newToken(), groups: ['church'] });
  const stays = person({ token: newToken(), groups: ['church'] });
  writePersonalFeeds(cfg, [gone, stays], MASTERS, OUT);
  assert.ok(existsSync(join(OUT, 'f', gone.token + '.ics')));

  const r = writePersonalFeeds(cfg, [stays], MASTERS, OUT);
  assert.equal(existsSync(join(OUT, 'f', gone.token + '.ics')), false, 'a deleted person kept their feed');
  assert.ok(existsSync(join(OUT, 'f', stays.token + '.ics')));
  assert.equal(r.removed, 1);
});

test('somebody with nothing selected gets an empty calendar, not a 404', () => {
  reset();
  const p = person({ groups: [] });
  const r = writePersonalFeeds(cfg, [p], MASTERS, OUT);
  const ics = feed(p.token);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.ok(!ics.includes('BEGIN:VEVENT'));
  assert.equal(r.empty, 1);
});

test('a column for a ministry that no longer exists includes nothing', () => {
  reset();
  const p = person({ groups: ['church', 'brass-band'] });
  writePersonalFeeds(cfg, [p], MASTERS, OUT);
  const ics = feed(p.token);
  assert.ok(ics.includes('Revival night'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test('feeds are named by token and nothing else is written', () => {
  reset();
  const a = person({ token: newToken(), groups: ['church'] });
  const b = person({ token: newToken(), groups: ['youth'] });
  writePersonalFeeds(cfg, [a, b], MASTERS, OUT);
  const files = readdirSync(join(OUT, 'f')).sort();
  assert.deepEqual(files, [a.token + '.ics', b.token + '.ics'].sort());
});

test('an unrelated file in the feed directory is cleaned up', () => {
  reset();
  mkdirSync(join(OUT, 'f'), { recursive: true });
  writeFileSync(join(OUT, 'f', 'stale.ics'), 'BEGIN:VCALENDAR');
  const p = person({ groups: ['church'] });
  writePersonalFeeds(cfg, [p], MASTERS, OUT);
  assert.equal(existsSync(join(OUT, 'f', 'stale.ics')), false);
});

// ---------------------------------------------------------------------------

test('tokens are long enough that sweeping for a valid one is hopeless', () => {
  const t = newToken();
  assert.equal(t.length, 32, '128 bits of hex');
  assert.ok(isValidToken(t));
  // Distinct across many draws; a repeat would mean the generator is broken.
  const many = new Set(Array.from({ length: 500 }, newToken));
  assert.equal(many.size, 500);
});

test('a token that could escape the feed directory is rejected', () => {
  for (const bad of ['../secret', 'a/b', 'short', '', 'has space', 'x'.repeat(65), 'tok.en']) {
    assert.equal(isValidToken(bad), false, bad + ' was accepted');
  }
});

test('duplicate tokens are reported, never silently merged', () => {
  const shared = newToken();
  const people = [person({ token: shared }), person({ token: shared }), person({ token: newToken() })];
  assert.deepEqual(duplicateTokens(people), [shared]);
  assert.deepEqual(duplicateTokens([person({}), person({})]), []);
});

test.after(() => rmSync(OUT, { recursive: true, force: true }));
