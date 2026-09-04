import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.ts';
import { normalize } from '../src/normalize.ts';
import {
  planReminders, planDigest, sendReminders, reminderText, howSoon,
  parseRule, loadState, saveState, pruneState, statePath,
} from '../src/remind.ts';
import type { CalEvent, Config, Ministry, RawEvent, ReminderState } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;

/** 9am local on 2026-09-04, which is the configured send hour. */
const NINE_AM = new Date('2026-09-04T09:00:00-04:00');

const YOUTH = cfg.ministries.find((m) => m.id === 'youth')!;
const CHURCH = cfg.ministries.find((m) => m.id === 'church')!;

function ev(patch: Partial<RawEvent>, id = 'e1'): CalEvent {
  return normalize(
    {
      ministry: 'youth',
      id,
      iCalUID: id + '@google.com',
      status: 'confirmed',
      summary: 'Youth car wash',
      start: { dateTime: '2026-09-11T09:00:00-04:00' },
      end: { dateTime: '2026-09-11T13:00:00-04:00' },
      ...patch,
    } as RawEvent,
    TZ,
    NINE_AM,
  );
}

function plan(instances: CalEvent[], opts: {
  state?: ReminderState | null;
  now?: Date;
  masters?: CalEvent[];
  ministries?: Ministry[];
  cfg?: Config;
} = {}) {
  return planReminders({
    cfg: opts.cfg ?? cfg,
    ministries: opts.ministries ?? [YOUTH, CHURCH],
    instances,
    masters: opts.masters ?? [],
    state: opts.state === undefined ? { sent: {} } : opts.state,
    now: opts.now ?? NINE_AM,
  });
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

test('an event reminds a week before and the day before, and nothing else', () => {
  const days = [0, 1, 2, 6, 7, 8, 14, 30];
  const fired = days.filter((d) => {
    const start = new Date(NINE_AM.getTime() + d * 86400000);
    const e = ev({ start: { dateTime: start.toISOString() }, end: { dateTime: start.toISOString() } });
    return plan([e]).due.length > 0;
  });
  assert.deepEqual(fired, [1, 7]);
});

test('a deadline reminds a month, a week, a day before, and on the day', () => {
  const fired = [0, 1, 3, 7, 30, 31].filter((d) => {
    const start = new Date(NINE_AM.getTime() + d * 86400000);
    const e = ev({ summary: 'Permission forms due', start: { date: start.toISOString().slice(0,10) }, end: { date: start.toISOString().slice(0,10) } });
    return plan([e]).due.length > 0;
  });
  assert.deepEqual(fired, [0, 1, 7, 30]);
});

test('a routine fixture is never reminded about', () => {
  for (const d of [0, 1, 7, 30]) {
    const start = new Date(NINE_AM.getTime() + d * 86400000);
    const e = ev({
      summary: 'ROUTINE: Sunday morning worship',
      start: { dateTime: start.toISOString() },
      end: { dateTime: start.toISOString() },
    });
    assert.equal(plan([e]).due.length, 0, 'fired at ' + d + ' days');
  }
});

test('a ministry with no channel is never reminded about', () => {
  // church has notify: [], youth has youth-parents.
  const start = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const churchEv = ev({ ministry: 'church', start: { dateTime: start }, end: { dateTime: start } });
  assert.equal(plan([churchEv]).due.length, 0);

  const youthEv = ev({ ministry: 'youth', start: { dateTime: start }, end: { dateTime: start } });
  assert.equal(plan([youthEv]).due.length, 1);
});

test('past events are never reminded about', () => {
  const past = new Date(NINE_AM.getTime() - 3 * 86400000).toISOString();
  assert.equal(plan([ev({ start: { dateTime: past }, end: { dateTime: past } })]).due.length, 0);
});

// ---------------------------------------------------------------------------
// the guards, which are the point of this file
// ---------------------------------------------------------------------------

test('nothing goes out except at the send hour', () => {
  const start = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const e = ev({ start: { dateTime: start }, end: { dateTime: start } });
  for (const hour of [6, 8, 10, 18, 23]) {
    const now = new Date(NINE_AM);
    now.setHours(now.getHours() + (hour - 9));
    const p = plan([e], { now });
    assert.equal(p.due.length, 0, 'fired at ' + hour + ':00');
    assert.ok(p.skipped);
  }
});

test('the same rung never fires twice', () => {
  const start = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const e = ev({ start: { dateTime: start }, end: { dateTime: start } });

  const first = plan([e]);
  assert.equal(first.due.length, 1);

  const state: ReminderState = { sent: { [first.due[0].key]: NINE_AM.toISOString() } };
  assert.equal(plan([e], { state }).due.length, 0);
});

test('the very first run sends nothing at all', () => {
  const starts = [1, 7, 30].map((d) => new Date(NINE_AM.getTime() + d * 86400000).toISOString());
  const events = starts.map((s, i) =>
    ev({ summary: 'Forms due', start: { dateTime: s }, end: { dateTime: s } }, 'e' + i));

  const p = plan(events, { state: null });
  assert.equal(p.seeding, true, 'a missing state file must mean seeding, not sending');
  assert.ok(p.due.length > 0, 'it should still work out what it would have sent');
});

test('a corrupt state file stops the run rather than re-sending everything', () => {
  const dir = join(tmpdir(), 'glbc-remind-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'job', 'state'), { recursive: true });
  const path = statePath(dir);
  writeFileSync(path, '{ this is not json');
  assert.throws(() => loadState(path), /unreadable/);
  rmSync(dir, { recursive: true, force: true });
});

test('a dry run sends nothing and records nothing', async () => {
  const start = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const e = ev({ start: { dateTime: start }, end: { dateTime: start } });
  const due = plan([e]).due;
  assert.equal(due.length, 1);

  process.env.GROUPME_BOT_YOUTH_PARENTS = 'pretend-bot-id';
  const state: ReminderState = { sent: {} };
  const lines: string[] = [];
  const out = await sendReminders(cfg, due, state, {
    dryRun: true, now: NINE_AM, log: (s) => lines.push(s),
  });
  delete process.env.GROUPME_BOT_YOUTH_PARENTS;

  assert.equal(out.sent, 0);
  assert.deepEqual(state.sent, {}, 'a dry run must not mark anything as sent');
  assert.ok(lines.some((l) => l.includes('dry run')));
});

test('with no bot configured nothing is sent and nothing is recorded', async () => {
  delete process.env.GROUPME_BOT_YOUTH_PARENTS;
  const start = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const due = plan([ev({ start: { dateTime: start }, end: { dateTime: start } })]).due;
  const state: ReminderState = { sent: {} };
  const out = await sendReminders(cfg, due, state, { dryRun: false, now: NINE_AM, log: () => {} });
  assert.equal(out.sent, 0);
  assert.deepEqual(state.sent, {}, 'it must still be owed once a bot exists');
});

// ---------------------------------------------------------------------------
// recurring series
// ---------------------------------------------------------------------------

test('a weekly series gets the full ladder once, then only the day before', () => {
  const master = ev({
    id: 'series', iCalUID: 'series@google.com',
    summary: 'Wednesday class',
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=6'],
  }, 'series');

  // Two occurrences seven days out: the first upcoming one, and a later one.
  const inSeven = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();
  const inOne = new Date(NINE_AM.getTime() + 1 * 86400000).toISOString();

  const firstUpcoming = ev({
    id: 'occ1', iCalUID: 'occ1@google.com', recurringEventId: 'series',
    start: { dateTime: inOne }, end: { dateTime: inOne },
  }, 'occ1');
  const later = ev({
    id: 'occ2', iCalUID: 'occ2@google.com', recurringEventId: 'series',
    start: { dateTime: inSeven }, end: { dateTime: inSeven },
  }, 'occ2');

  const p = plan([firstUpcoming, later], { masters: [master] });
  const rules = p.due.map((d) => d.ruleId).sort();

  // occ1 is the first upcoming, one day out, so its 1d rung fires.
  // occ2 is seven days out but is NOT the first, so its 7d rung is suppressed.
  assert.deepEqual(rules, ['1d'], 'a later occurrence should not fire the week-ahead rung');
});

test('a monthly series is not throttled', () => {
  const master = ev({
    id: 'monthly', iCalUID: 'monthly@google.com',
    recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TU'],
  }, 'monthly');
  const inOne = new Date(NINE_AM.getTime() + 1 * 86400000).toISOString();
  const inSeven = new Date(NINE_AM.getTime() + 7 * 86400000).toISOString();

  const a = ev({ id: 'm1', iCalUID: 'm1@google.com', recurringEventId: 'monthly',
    start: { dateTime: inOne }, end: { dateTime: inOne } }, 'm1');
  const b = ev({ id: 'm2', iCalUID: 'm2@google.com', recurringEventId: 'monthly',
    start: { dateTime: inSeven }, end: { dateTime: inSeven } }, 'm2');

  const rules = plan([a, b], { masters: [master] }).due.map((d) => d.ruleId).sort();
  assert.deepEqual(rules, ['1d', '7d']);
});

// ---------------------------------------------------------------------------
// wording, which parents actually read
// ---------------------------------------------------------------------------

test('a deadline reminder names the date, not just a countdown', () => {
  const e = ev({
    summary: 'Permission forms due',
    start: { date: '2026-09-11' }, end: { date: '2026-09-12' },
    description: 'Signed form and medical release.\ncost: $75\ncontact: Bro. Spencer',
  });
  const text = reminderText(e, 7, TZ);
  assert.ok(text.includes('Permission forms due'));
  assert.ok(text.includes('Friday, September 11'), 'the actual date must appear');
  assert.ok(text.includes('in a week'));
  assert.ok(text.includes('Cost: $75'));
  assert.ok(text.includes('Questions: Bro. Spencer'));
});

test('a day-of deadline says so unmistakably', () => {
  const e = ev({ summary: 'Money due', start: { date: '2026-09-04' }, end: { date: '2026-09-05' } });
  assert.ok(reminderText(e, 0, TZ).startsWith('DUE TODAY:'));
});

test('a timed event carries its time', () => {
  const e = ev({});
  const text = reminderText(e, 1, TZ);
  assert.ok(text.includes('9 AM'), text);
  assert.ok(text.includes('tomorrow'));
});

test('howSoon reads like a person wrote it', () => {
  assert.equal(howSoon(0), 'today');
  assert.equal(howSoon(1), 'tomorrow');
  assert.equal(howSoon(7), 'in a week');
  assert.equal(howSoon(3), 'in 3 days');
  assert.equal(howSoon(30), 'in 4 weeks');
});

// ---------------------------------------------------------------------------

test('the digest only goes out on Sunday evening, and only with something in it', () => {
  const soon = new Date(NINE_AM.getTime() + 2 * 86400000).toISOString();
  const e = ev({ start: { dateTime: soon }, end: { dateTime: soon } });

  // Friday 9am: not the digest slot.
  assert.equal(planDigest({ cfg, ministries: [YOUTH], instances: [e], masters: [], state: { sent: {} }, now: NINE_AM }).length, 0);

  // Sunday 7pm.
  const sunday = new Date('2026-09-06T19:00:00-04:00');
  const later = new Date(sunday.getTime() + 2 * 86400000).toISOString();
  const withEvent = ev({ start: { dateTime: later }, end: { dateTime: later } });
  const digest = planDigest({ cfg, ministries: [YOUTH], instances: [withEvent], masters: [], state: { sent: {} }, now: sunday });
  assert.equal(digest.length, 1);
  assert.ok(digest[0].text.startsWith('The week ahead:'));

  // Sunday 7pm with an empty week: silence beats an empty list.
  assert.equal(planDigest({ cfg, ministries: [YOUTH], instances: [], masters: [], state: { sent: {} }, now: sunday }).length, 0);
});

test('parseRule accepts the ladder format and rejects anything else', () => {
  assert.equal(parseRule('30d'), 30);
  assert.equal(parseRule('0d'), 0);
  assert.equal(parseRule('7D'), 7);
  assert.equal(parseRule('later'), null);
  assert.equal(parseRule('7'), null);
});

test('old keys are pruned, recent ones kept', () => {
  const old = new Date(NINE_AM.getTime() - 200 * 86400000).toISOString();
  const recent = new Date(NINE_AM.getTime() - 3 * 86400000).toISOString();
  const pruned = pruneState({ sent: { oldKey: old, newKey: recent } }, NINE_AM);
  assert.deepEqual(Object.keys(pruned.sent), ['newKey']);
});

test('state survives a round trip', () => {
  const dir = join(tmpdir(), 'glbc-remind-state');
  rmSync(dir, { recursive: true, force: true });
  const path = statePath(dir);
  assert.equal(loadState(path), null);
  saveState(path, { sent: { a: NINE_AM.toISOString() }, seededAt: NINE_AM.toISOString() });
  assert.ok(existsSync(path));
  assert.deepEqual(loadState(path)?.sent, { a: NINE_AM.toISOString() });
  rmSync(dir, { recursive: true, force: true });
});
