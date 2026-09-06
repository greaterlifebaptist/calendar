import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comboSlug, comboMinistries, writeComboFeeds } from '../src/combo.ts';
import { normalize } from '../src/normalize.ts';
import { loadConfig } from '../src/config.ts';
import type { CalEvent, RawEvent } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;
const NOW = new Date('2026-09-04T12:00:00-04:00');

function cal(ministry: string, summary: string): CalEvent {
  return normalize(
    {
      ministry,
      id: ministry + '-' + summary,
      iCalUID: ministry + '-' + summary + '@google.com',
      status: 'confirmed',
      summary,
      start: { dateTime: '2026-09-10T19:00:00-04:00' },
      end: { dateTime: '2026-09-10T20:30:00-04:00' },
    } as RawEvent,
    TZ,
    NOW,
  );
}

function inTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'glbc-combo-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the slug does not depend on the order boxes were ticked', () => {
  assert.equal(comboSlug(['youth', 'church']), comboSlug(['church', 'youth']));
  assert.equal(comboSlug(['church', 'youth']), 'church-youth');
  assert.equal(comboSlug(['youth', 'youth']), 'youth');
});

test('every combination of public ministries gets a file', () => {
  inTempDir((dir) => {
    const pool = comboMinistries(cfg);
    const result = writeComboFeeds(cfg, [], dir);
    assert.equal(result.written, 2 ** pool.length - 1);

    // Every subset is reachable, which is the whole point: no selection can
    // send somebody to a URL that has to be built first.
    const files = new Set(readdirSync(join(dir, 'c')));
    for (const m of pool) assert.ok(files.has(m.id + '.ics'), 'missing ' + m.id);
    assert.ok(files.has(comboSlug(pool.map((m) => m.id)) + '.ics'), 'missing the everything feed');
  });
});

test('a private ministry never appears in a combination', () => {
  inTempDir((dir) => {
    const priv = cfg.ministries.filter((m) => m.visibility !== 'public').map((m) => m.id);
    assert.ok(priv.length, 'this test is pointless without a private ministry');

    const events = cfg.ministries.map((m) => cal(m.id, 'Meeting for ' + m.id));
    writeComboFeeds(cfg, events, dir);

    for (const name of readdirSync(join(dir, 'c'))) {
      const body = readFileSync(join(dir, 'c', name), 'utf8');
      for (const id of priv) {
        assert.ok(!name.includes(id), name + ' names a private ministry');
        assert.ok(!body.includes('Meeting for ' + id), name + ' contains a private event');
      }
    }
  });
});

test('a combination holds exactly the events of its parts', () => {
  inTempDir((dir) => {
    const pool = comboMinistries(cfg).slice(0, 2);
    assert.equal(pool.length, 2, 'needs two public ministries to be meaningful');
    const [a, b] = pool as [(typeof pool)[0], (typeof pool)[0]];

    const events = [cal(a.id, 'Alpha'), cal(b.id, 'Beta')];
    writeComboFeeds(cfg, events, dir);

    const read = (slug: string) => readFileSync(join(dir, 'c', slug + '.ics'), 'utf8');
    const alone = read(a.id);
    assert.ok(alone.includes('Alpha'));
    assert.ok(!alone.includes('Beta'));

    const both = read(comboSlug([a.id, b.id]));
    assert.ok(both.includes('Alpha') && both.includes('Beta'));
  });
});

test('an empty combination is still a valid calendar, not a 404', () => {
  inTempDir((dir) => {
    writeComboFeeds(cfg, [], dir);
    const first = readdirSync(join(dir, 'c'))[0]!;
    const body = readFileSync(join(dir, 'c', first), 'utf8');
    assert.ok(body.startsWith('BEGIN:VCALENDAR'));
    assert.ok(body.trimEnd().endsWith('END:VCALENDAR'));
  });
});

test('a file for a combination that no longer exists is retired', () => {
  inTempDir((dir) => {
    writeComboFeeds(cfg, [], dir);
    const stale = join(dir, 'c', 'church-gonepublic.ics');
    writeFileSync(stale, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'utf8');

    const again = writeComboFeeds(cfg, [], dir);
    assert.equal(again.removed, 1);
    assert.ok(!readdirSync(join(dir, 'c')).includes('church-gonepublic.ics'));
  });
});

test('the slug rule the Apps Script copies is sorted and hyphen-joined', () => {
  // Both sides build this independently, so drift would hand somebody a URL
  // that does not exist. Public ministry ids must therefore stay hyphen-free.
  for (const m of comboMinistries(cfg)) {
    assert.ok(!m.id.includes('-'), m.id + ' contains a hyphen and would break the slug');
  }
});
