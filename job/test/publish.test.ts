import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, activeMinistries, outputDir } from '../src/config.ts';
import { fetchAll } from '../src/fetch.ts';
import { normalizeAll, dedupe, byStart } from '../src/normalize.ts';
import { publish, toPublicEvent } from '../src/publish.ts';
import { normalize } from '../src/normalize.ts';
import type { EventsJson, RawEvent } from '../src/types.ts';

process.env.FIXTURES = 'true';

const cfg = loadConfig();
const TZ = cfg.timezone;
const NOW = new Date('2026-09-04T12:00:00-04:00');

async function runPipeline() {
  const ministries = activeMinistries(cfg);
  const results = await fetchAll(cfg, ministries, NOW, NOW);
  const instances = results.flatMap((r) => normalizeAll(r.instances, TZ, NOW));
  const masters = results.flatMap((r) => normalizeAll(r.masters, TZ, NOW));
  publish({ cfg, ministries, instances: dedupe(instances).sort(byStart), masters, generated: NOW });
  return {
    events: JSON.parse(readFileSync(join(outputDir(), 'events.json'), 'utf8')) as EventsJson,
    feedsDir: join(outputDir(), 'feeds'),
  };
}

test('no private ministry reaches any published file', async () => {
  const { events, feedsDir } = await runPipeline();
  const privateIds = cfg.ministries.filter((m) => m.visibility === 'private').map((m) => m.id);
  assert.ok(privateIds.includes('youth-leaders'), 'guard assumes youth-leaders is private');

  for (const id of privateIds) {
    assert.equal(
      events.events.some((e) => e.ministry === id),
      false,
      id + ' leaked into events.json',
    );
    assert.equal(
      events.ministries.some((m) => m.id === id),
      false,
      id + ' listed as a filter pill',
    );
    assert.equal(existsSync(join(feedsDir, id + '.ics')), false, id + '.ics was published');
  }

  // Belt and braces: no private event's text appears anywhere under public/.
  const blob = readdirSync(feedsDir)
    .map((f) => readFileSync(join(feedsDir, f), 'utf8'))
    .join('\n') + JSON.stringify(events);
  assert.ok(!blob.includes('Budget request'), 'private event title found in published output');
  assert.ok(!blob.includes('ldr-monthly'), 'private event uid found in published output');
});

test('a bundle feed exists for every enabled public ministry, plus all.ics', async () => {
  const { feedsDir } = await runPipeline();
  const files = new Set(readdirSync(feedsDir));
  const expected = activeMinistries(cfg).filter((m) => m.visibility === 'public');
  for (const m of expected) assert.ok(files.has(m.id + '.ics'), 'missing ' + m.id + '.ics');
  assert.ok(files.has(cfg.site.allFeed));
  assert.equal(files.size, expected.length + 1, 'stale feed files were left behind');
});

test('all.ics carries every public event and no private one', async () => {
  const { events, feedsDir } = await runPipeline();
  const all = readFileSync(join(feedsDir, cfg.site.allFeed), 'utf8');
  // Unfold before matching: a long SUMMARY is split across physical lines.
  const summaries = new Set(
    [...all.replace(/\r\n[ \t]/g, '').matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1].trim()),
  );

  // Match on title, not uid: an occurrence that overrides its series is
  // published under the series UID with a RECURRENCE-ID, which is correct
  // ICS but means its per-instance events.json uid will not appear here.
  for (const e of events.events) {
    const escaped = e.title.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
    assert.ok(summaries.has(escaped), 'all.ics is missing "' + e.title + '"');
  }

  const uids = new Set([...all.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim()));
  assert.ok(!uids.has('ldr-budget@google.com'));
  assert.ok(!summaries.has('Budget request due to the church treasurer'));
});

test('events.json is sorted and carries local wall-clock times', async () => {
  const { events } = await runPipeline();
  const starts = events.events.map((e) => e.start);
  assert.deepEqual(starts, [...starts].sort(), 'events must be in date order');
  for (const e of events.events) {
    assert.ok(!/[Zz]|[+]\d\d:?\d\d$/.test(e.start), e.start + ' should have no UTC offset');
  }
});

test('a single-day all-day event has no end date', () => {
  const raw: RawEvent = {
    ministry: 'youth',
    id: 'z',
    iCalUID: 'z@google.com',
    status: 'confirmed',
    summary: 'Forms due',
    start: { date: '2026-09-30' },
    end: { date: '2026-10-01' },
  };
  const out = toPublicEvent(normalize(raw, TZ, NOW), TZ);
  assert.equal(out.start, '2026-09-30');
  assert.equal(out.allDay, true);
  assert.equal(out.end, undefined);
});

test('a multi-day all-day event ends on its last real day', () => {
  const raw: RawEvent = {
    ministry: 'youth',
    id: 'z',
    iCalUID: 'z@google.com',
    status: 'confirmed',
    summary: 'Youth trip',
    start: { date: '2027-07-12' },
    end: { date: '2027-07-18' },
  };
  const out = toPublicEvent(normalize(raw, TZ, NOW), TZ);
  assert.equal(out.end, '2027-07-17');
});

test('a ministry with nothing scheduled is not offered on the site', async () => {
  const { events, feedsDir } = await runPipeline();
  const listed = new Set(events.ministries.map((m) => m.id));
  const withEvents = new Set(events.events.map((e) => e.ministry));

  // The fixtures only cover church and youth; the rest have real calendars
  // configured but nothing in them.
  assert.ok(listed.has('church') && listed.has('youth'));
  for (const id of ['children', 'mens', 'seniors', 'womens', 'youngadults']) {
    assert.equal(listed.has(id), false, id + ' offered despite having no events');
    assert.equal(withEvents.has(id), false);
    // ...but its feed still exists, or anyone already subscribed would 404.
    assert.ok(existsSync(join(feedsDir, id + '.ics')), id + '.ics disappeared');
  }
});

test('every listed ministry actually has something coming up', async () => {
  const { events } = await runPipeline();
  const withEvents = new Set(events.events.map((e) => e.ministry));
  for (const m of events.ministries) {
    assert.ok(withEvents.has(m.id), m.id + ' is listed but has no events');
  }
});

test('with nothing scheduled anywhere, no ministry is offered at all', () => {
  const ministries = activeMinistries(cfg);
  publish({ cfg, ministries, instances: [], masters: [], generated: NOW });
  const events = JSON.parse(
    readFileSync(join(outputDir(), 'events.json'), 'utf8'),
  ) as EventsJson;
  assert.equal(events.events.length, 0);
  assert.equal(
    events.ministries.length,
    0,
    'empty pills are worse than an honest empty page',
  );
});

test('only past events does not count as being in use', () => {
  const ministries = activeMinistries(cfg);
  const past = normalize(
    {
      ministry: 'church',
      id: 'old',
      iCalUID: 'old@google.com',
      status: 'confirmed',
      summary: 'Last week',
      start: { dateTime: '2026-09-01T19:00:00-04:00' },
      end: { dateTime: '2026-09-01T20:00:00-04:00' },
    } as RawEvent,
    TZ,
    NOW,
  );
  publish({ cfg, ministries, instances: [past], masters: [past], generated: NOW });
  const events = JSON.parse(
    readFileSync(join(outputDir(), 'events.json'), 'utf8'),
  ) as EventsJson;
  assert.equal(events.ministries.length, 0, 'a finished event should not keep a ministry listed');
});
