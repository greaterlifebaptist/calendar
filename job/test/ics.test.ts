import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, fold, escapeText, toIcsInputs } from '../src/ics.ts';
import { normalize } from '../src/normalize.ts';
import { loadConfig } from '../src/config.ts';
import type { CalEvent, RawEvent } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;
const NOW = new Date('2026-09-04T12:00:00-04:00');

function cal(raw: Partial<RawEvent>): CalEvent {
  return normalize(
    {
      ministry: 'church',
      id: 'a',
      iCalUID: 'a@google.com',
      status: 'confirmed',
      summary: 'Thing',
      start: { dateTime: '2026-09-10T19:00:00-04:00' },
      end: { dateTime: '2026-09-10T20:30:00-04:00' },
      ...raw,
    } as RawEvent,
    TZ,
    NOW,
  );
}

function build(events: CalEvent[]): string {
  return buildIcs(toIcsInputs(events, TZ), cfg, { name: 'Test' });
}

/** Undo RFC 5545 line folding so assertions can look at logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
}

test('every physical line fits in 75 octets and ends CRLF', () => {
  const ics = build([
    cal({ summary: 'A very long title '.repeat(12), location: 'Somewhere ünïcödé far away'.repeat(4) }),
  ]);
  assert.ok(ics.endsWith('\r\n'));
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line too long: ' + line.slice(0, 90));
  }
});

test('folding never splits a multi-byte character', () => {
  const folded = fold('SUMMARY:' + 'é'.repeat(80));
  for (const piece of folded.split('\r\n ')) {
    assert.ok(!piece.includes('�'), 'folding produced a replacement character');
  }
  assert.equal(folded.replace(/\r\n /g, ''), 'SUMMARY:' + 'é'.repeat(80));
});

test('text values escape the reserved characters', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('BEGIN and END blocks balance', () => {
  const ics = build([cal({}), cal({ id: 'b', iCalUID: 'b@google.com' })]);
  const lines = unfold(ics);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  const begins = lines.filter((l) => l.startsWith('BEGIN:')).length;
  const ends = lines.filter((l) => l.startsWith('END:')).length;
  assert.equal(begins, ends);
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
});

test('a VTIMEZONE is present for every TZID reference', () => {
  const ics = build([cal({})]);
  assert.ok(ics.includes('BEGIN:VTIMEZONE\r\nTZID:America/New_York'));
  assert.ok(ics.includes('DTSTART;TZID=America/New_York:20260910T190000'));
});

test('timed events use local time, not UTC, so recurrence survives DST', () => {
  const ics = build([
    cal({ summary: 'Thursday night service', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'] }),
  ]);
  assert.ok(ics.includes('DTSTART;TZID=America/New_York:'));
  assert.ok(!/DTSTART[;:][^\r\n]*\dZ/.test(ics), 'DTSTART must not be written in UTC');
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=TH'));
});

test('recurring events keep the rule and are never expanded', () => {
  const ics = build([cal({ recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'] })]);
  assert.equal(unfold(ics).filter((l) => l === 'BEGIN:VEVENT').length, 1);
});

test('all-day events use VALUE=DATE with an exclusive end', () => {
  const ics = build([
    cal({ summary: 'Youth trip', start: { date: '2027-07-12' }, end: { date: '2027-07-18' } }),
  ]);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270712'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20270718'));
});

test('a cancelled occurrence becomes an EXDATE on its series', () => {
  const master = cal({
    id: 'svc',
    iCalUID: 'svc@google.com',
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'],
  });
  const cancelled = cal({
    id: 'svc_x',
    iCalUID: 'svc_x@google.com',
    status: 'cancelled',
    recurringEventId: 'svc',
    originalStartTime: { dateTime: '2026-11-26T19:00:00-05:00' },
    start: { dateTime: '2026-11-26T19:00:00-05:00' },
  });
  const ics = build([master, cancelled]);
  assert.equal(unfold(ics).filter((l) => l === 'BEGIN:VEVENT').length, 1);
  assert.ok(ics.includes('EXDATE;TZID=America/New_York:20261126T190000'));
});

test('a moved occurrence keeps the series UID and gains a RECURRENCE-ID', () => {
  // The series is explicitly ROUTINE:. The moved occurrence carries no
  // recurrence of its own, so left to itself it would classify as an ordinary
  // event. Asserting it comes out routine is what proves it inherited.
  const master = cal({
    id: 'svc',
    iCalUID: 'svc@google.com',
    summary: 'ROUTINE: Sunday morning worship',
    start: { dateTime: '2026-09-06T11:00:00-04:00' },
    end: { dateTime: '2026-09-06T12:15:00-04:00' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU'],
  });
  const moved = cal({
    id: 'svc_m',
    iCalUID: 'svc_m@google.com',
    summary: 'Sunday morning worship — combined singing',
    recurringEventId: 'svc',
    originalStartTime: { dateTime: '2026-12-27T11:00:00-05:00' },
    start: { dateTime: '2026-12-27T10:30:00-05:00' },
    end: { dateTime: '2026-12-27T12:00:00-05:00' },
  });
  const ics = build([master, moved]);
  const lines = unfold(ics);
  assert.equal(lines.filter((l) => l === 'UID:svc@google.com').length, 2);
  assert.ok(ics.includes('RECURRENCE-ID;TZID=America/New_York:20261227T110000'));
  assert.equal(
    lines.filter((l) => l === 'X-GLBC-TYPE:routine').length,
    2,
    'the moved occurrence re-inferred its own type instead of inheriting the series',
  );
});

test('an override whose series is out of window is published standalone', () => {
  const orphan = cal({
    id: 'orphan',
    iCalUID: 'orphan@google.com',
    recurringEventId: 'gone',
    originalStartTime: { dateTime: '2026-09-10T19:00:00-04:00' },
  });
  const ics = build([orphan]);
  assert.ok(ics.includes('UID:orphan@google.com'));
  assert.ok(!ics.includes('RECURRENCE-ID'));
});

test('parsed fields come back in the DESCRIPTION for subscribers', () => {
  const ics = build([
    cal({ description: 'Bring a bag.\ncost: $10\ncontact: Bro. Spencer\nlink: Form https://ex.org/f' }),
  ]);
  const desc = unfold(ics).find((l) => l.startsWith('DESCRIPTION:'));
  assert.ok(desc);
  assert.ok(desc.includes('Bring a bag.'));
  assert.ok(desc.includes('Cost: $10'));
  assert.ok(desc.includes('Contact: Bro. Spencer'));
  assert.ok(ics.includes('URL:https://ex.org/f'));
});

test('a feed is byte-identical across runs, so the hourly cron stays quiet', async () => {
  const events = [
    cal({}),
    cal({ id: 'b', iCalUID: 'b@google.com', updated: '2026-08-20T12:00:00Z' }),
    // No created/updated at all: the fallback must not read the clock either.
    cal({ id: 'c', iCalUID: 'c@google.com', created: undefined, updated: undefined }),
  ];
  const first = build(events);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(build(events), first, 'feed contents drifted between runs');
});
