import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, activeMinistries } from '../src/config.ts';
import { fetchAll } from '../src/fetch.ts';
import { writeBackup } from '../src/backup.ts';

process.env.FIXTURES = 'true';

const cfg = loadConfig();
const NOW = new Date('2026-09-04T12:00:00-04:00');
const DIR = join(tmpdir(), 'glbc-backup-test');

async function snapshot(now: Date = NOW) {
  const ministries = activeMinistries(cfg);
  const results = await fetchAll(cfg, ministries, NOW, NOW);
  return writeBackup(cfg, results, DIR, now);
}

/** Every calendar file as one string, for comparing two captures. */
function calendarBytes(): string {
  return readdirSync(join(DIR, 'calendars'))
    .sort()
    .map((f) => readFileSync(join(DIR, 'calendars', f), 'utf8'))
    .join('|');
}

test('the backup covers private ministries, unlike everything published', async () => {
  const r = await snapshot();
  const files = readdirSync(join(DIR, 'calendars'));
  const privateIds = cfg.ministries.filter((m) => m.visibility === 'private').map((m) => m.id);
  assert.ok(privateIds.length > 0);
  for (const id of privateIds) {
    assert.ok(files.includes(id + '.json'), 'private ministry ' + id + ' was not backed up');
  }
  const leaders = JSON.parse(readFileSync(join(DIR, 'calendars', 'youth-leaders.json'), 'utf8'));
  assert.equal(leaders.visibility, 'private');
  assert.ok(leaders.items.some((e: any) => /Budget request/.test(e.summary ?? '')));
  assert.ok(r.calendars >= privateIds.length);
});

test('snapshots are verbatim API resources, not our classified shape', async () => {
  await snapshot();
  const church = JSON.parse(readFileSync(join(DIR, 'calendars', 'church.json'), 'utf8'));
  const master = church.items.find((e: any) => e.id === 'svc-thu');
  assert.ok(master, 'recurrence master missing from the snapshot');
  assert.deepEqual(master.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH']);
  // Our own derived fields must not have leaked in; a restore replays Google's.
  assert.equal(master.type, undefined);
  assert.equal(master.pinned, undefined);
  assert.equal(master.startInstant, undefined);
  // Cancelled occurrences are kept, or a restore would resurrect them.
  assert.ok(church.items.some((e: any) => e.status === 'cancelled'));
});

test('a removed ministry does not leave a stale snapshot behind', async () => {
  await snapshot();
  const strayPath = join(DIR, 'calendars', 'gone.json');
  writeFileSync(strayPath, '{}');
  assert.ok(existsSync(strayPath));
  await snapshot();
  assert.equal(existsSync(strayPath), false, 'stale snapshot survived a later run');
});

test('a calendar file changes only when the calendar does', async () => {
  // The backup repository commits whenever a file differs, so a timestamp in
  // here would mean a commit every hour forever, and a history in which
  // finding the week a recurring series was deleted is hopeless. Two captures
  // an hour apart, of identical data, must be byte-identical.
  await snapshot(new Date('2026-09-06T01:00:00Z'));
  const first = calendarBytes();
  await snapshot(new Date('2026-09-06T02:00:00Z'));
  assert.equal(calendarBytes(), first);
});

test('the manifest still records when the capture happened', async () => {
  await snapshot(new Date('2026-09-06T02:00:00Z'));
  const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  assert.equal(m.capturedAt, '2026-09-06T02:00:00.000Z');
});

test('the manifest totals match the files on disk', async () => {
  const r = await snapshot();
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  const files = readdirSync(join(DIR, 'calendars'));
  assert.equal(manifest.calendars, files.length);
  assert.equal(manifest.calendars, r.calendars);
  const counted = manifest.index.reduce((n: number, i: any) => n + i.count, 0);
  assert.equal(counted, manifest.events);
  assert.equal(counted, r.events);
});

test.after(() => rmSync(DIR, { recursive: true, force: true }));
