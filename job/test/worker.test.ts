/**
 * The Worker merges feeds on request, which means a bug in it corrupts
 * somebody's calendar without anything in this repo looking wrong. It lives in
 * worker/, but its tests run here so they run in CI with everything else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFeed, identity, fold, buildMerged } from '../../worker/src/index.js';
import { buildIcs, toIcsInputs } from '../src/ics.ts';
import { normalize } from '../src/normalize.ts';
import { loadConfig } from '../src/config.ts';
import type { CalEvent, RawEvent } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;
const NOW = new Date('2026-09-04T12:00:00-04:00');

function cal(ministry: string, summary: string, uid?: string): CalEvent {
  return normalize(
    {
      ministry,
      id: uid ?? ministry + '-' + summary,
      iCalUID: (uid ?? ministry + '-' + summary) + '@google.com',
      status: 'confirmed',
      summary,
      start: { dateTime: '2026-09-10T19:00:00-04:00' },
      end: { dateTime: '2026-09-10T20:30:00-04:00' },
    } as RawEvent,
    TZ,
    NOW,
  );
}

/** A real feed, built by the same code that publishes the live ones. */
function feed(events: CalEvent[], name: string): string {
  return buildIcs(toIcsInputs(events, TZ), cfg, { name: 'Greater Life Baptist Church', description: name });
}

/** Stand in for the site, so nothing here touches the network. */
function withFeeds<T>(files: Record<string, string | number>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const match = /\/feeds\/([a-z0-9-]+)\.ics$/.exec(url);
    const body = match ? files[match[1]!] : undefined;
    if (typeof body === 'number') return new Response('missing', { status: body });
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/calendar' } });
  }) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = real; });
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
}

test('splitFeed lifts out the events and one timezone', () => {
  const parts = splitFeed(feed([cal('church', 'Alpha'), cal('church', 'Beta')], 'Church'));
  assert.equal(parts.events.length, 2);
  assert.equal(parts.timezone[0], 'BEGIN:VTIMEZONE');
  assert.equal(parts.timezone[parts.timezone.length - 1], 'END:VTIMEZONE');
  assert.ok(parts.events.every((b: string[]) => b[0] === 'BEGIN:VEVENT'));
  assert.ok(parts.events.every((b: string[]) => b[b.length - 1] === 'END:VEVENT'));
});

test('an event is taken verbatim, folding and all', () => {
  const long = cal('church', 'A very long title that will certainly need folding '.repeat(3));
  const source = feed([long], 'Church');
  const block = splitFeed(source).events[0]! as string[];
  // Every line of the block appears in the source exactly as it is, which is
  // the guarantee that merging cannot introduce an encoding bug of its own.
  for (const line of block) assert.ok(source.includes(line), 'line was altered: ' + line);
  assert.ok(block.some((l: string) => l.startsWith(' ')), 'this test needs a folded line');
});

test('the merge holds every event from every feed, once', async () => {
  await withFeeds(
    {
      church: feed([cal('church', 'Alpha')], 'Church'),
      youth: feed([cal('youth', 'Beta'), cal('youth', 'Gamma')], 'Youth'),
    },
    async () => {
      const ics = await buildMerged(['church', 'youth'], ['Church-wide', 'Greater Generation']);
      const lines = unfold(ics);
      assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 3);
      for (const title of ['Alpha', 'Beta', 'Gamma']) {
        assert.ok(ics.includes('SUMMARY:' + title), 'lost ' + title);
      }
    },
  );
});

test('one calendar wrapper and one timezone, not one per feed', async () => {
  await withFeeds(
    { church: feed([cal('church', 'Alpha')], 'Church'), youth: feed([cal('youth', 'Beta')], 'Youth') },
    async () => {
      const lines = unfold(await buildMerged(['church', 'youth'], ['Church-wide', 'Greater Generation']));
      assert.equal(lines.filter((l) => l === 'BEGIN:VCALENDAR').length, 1);
      assert.equal(lines.filter((l) => l === 'END:VCALENDAR').length, 1);
      assert.equal(lines.filter((l) => l === 'BEGIN:VTIMEZONE').length, 1);
      assert.equal(lines[0], 'BEGIN:VCALENDAR');
      assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
    },
  );
});

test('an event on two ministry calendars is drawn once', async () => {
  // A leader putting one revival on both the church and the youth calendar is
  // an ordinary thing to do, and it must not come back doubled.
  const shared = cal('church', 'Revival', 'shared-uid');
  await withFeeds(
    { church: feed([shared], 'Church'), youth: feed([{ ...shared, ministry: 'youth' }], 'Youth') },
    async () => {
      const ics = await buildMerged(['church', 'youth'], ['Church-wide', 'Greater Generation']);
      assert.equal(unfold(ics).filter((l) => l === 'BEGIN:VEVENT').length, 1);
    },
  );
});

test('identity separates a moved occurrence from its own series', () => {
  const series = ['BEGIN:VEVENT', 'UID:abc@google.com', 'END:VEVENT'];
  const moved = ['BEGIN:VEVENT', 'UID:abc@google.com', 'RECURRENCE-ID;TZID=America/New_York:20260910T190000', 'END:VEVENT'];
  assert.notEqual(identity(series), identity(moved));
  assert.equal(identity(series), identity([...series]));
});

test('a missing source feed fails the request instead of quietly dropping it', async () => {
  await withFeeds(
    { church: feed([cal('church', 'Alpha')], 'Church'), youth: 404 },
    async () => {
      await assert.rejects(
        () => buildMerged(['church', 'youth'], ['Church-wide', 'Greater Generation']),
        /youth returned 404/,
      );
    },
  );
});

test('the merged feed obeys the same line rules as the job\'s own', async () => {
  await withFeeds(
    { church: feed([cal('church', 'Alpha '.repeat(30))], 'Church-wide, Greater Generation, Soul Sisters') },
    async () => {
      const ics = await buildMerged(['church'], ['Church-wide', 'Greater Generation', 'Soul Sisters']);
      assert.ok(ics.endsWith('\r\n'));
      for (const line of ics.split('\r\n')) {
        assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line too long: ' + line);
      }
      // No stray bare newlines: every break must be CRLF.
      assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
    },
  );
});

test('fold splits on octets, not characters', () => {
  const folded = fold('X-WR-CALDESC:' + 'é'.repeat(60));
  for (const line of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  }
  assert.equal(folded.replace(/\r\n /g, ''), 'X-WR-CALDESC:' + 'é'.repeat(60));
});
