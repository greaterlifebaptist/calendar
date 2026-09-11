import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, parseFields } from '../src/classify.ts';
import { normalize } from '../src/normalize.ts';
import { planReminders, planDigest } from '../src/remind.ts';
import { loadConfig } from '../src/config.ts';
import { toPublicEvent } from '../src/publish.ts';
import type { RawEvent, CalEvent } from '../src/types.ts';

/**
 * "Put it on the TV from": a date before which an event stays off the wall.
 *
 * The wall only, which is narrower than it first was. It briefly hid the event
 * from the website and silenced its reminders too, on the reasoning that a
 * message about something invisible is a message nobody can act on. That
 * reasoning was built on an example the ladder cannot produce — the furthest
 * rung is thirty days, so there is no such thing as a reminder months out —
 * and it took away two things nobody asked to lose.
 *
 * A rule that hides things is the kind that fails quietly, in both directions:
 * hiding what should show is invisible until somebody misses it, and failing
 * to hide is only noticed by whoever is annoyed by the wall. Hence the tests
 * below, on both sides of every boundary.
 */
const cfg = loadConfig();
const TZ = cfg.timezone;

function raw(over: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'e1',
    ministry: 'youth',
    summary: 'Fundraiser money due',
    start: { date: '2027-02-28' },
    end: { date: '2027-03-01' },
    ...over,
  } as RawEvent;
}

test('the form field sets the date', () => {
  const out = classify(raw({
    extendedProperties: { shared: { glbcShowFrom: '2027-01-15' } },
  }), TZ, new Date('2026-09-10T12:00:00Z'));
  assert.equal(out.showFrom, '2027-01-15');
});

test('a show: line works for somebody typing into Google Calendar', () => {
  // The same route as cost:, link: and contact:, for a leader adding an event
  // from the Calendar app rather than the admin form.
  const fields = parseFields('Bring the money to Andrea.\nshow: 2027-01-15');
  assert.equal(fields.showFrom, '2027-01-15');
  // And the line itself does not survive into what the website prints.
  assert.equal(fields.notes, 'Bring the money to Andrea.');
});

test('the form wins over a show: line', () => {
  const out = classify(raw({
    description: 'show: 2027-01-01',
    extendedProperties: { shared: { glbcShowFrom: '2027-02-01' } },
  }), TZ, new Date('2026-09-10T12:00:00Z'));
  assert.equal(out.showFrom, '2027-02-01');
});

test('anything that is not a plain date is ignored', () => {
  // Half-understanding a date would hide an event on a day nobody chose,
  // which is worse than showing it early.
  for (const value of ['when the fundraiser starts', 'Jan 15', '2027-1-5', '', '   ']) {
    assert.equal(parseFields('show: ' + value).showFrom, null, value + ' should be ignored');
    const out = classify(raw({
      extendedProperties: { shared: { glbcShowFrom: value } },
    }), TZ, new Date('2026-09-10T12:00:00Z'));
    assert.equal(out.showFrom, null, value + ' should be ignored');
  }
});

test('no date at all is the normal case and means show it now', () => {
  const out = classify(raw(), TZ, new Date('2026-09-10T12:00:00Z'));
  assert.equal(out.showFrom, null);
});

test('the date reaches the website, and is left off when there is none', () => {
  const withDate = toPublicEvent({
    ...raw(),
    ...classify(raw({ extendedProperties: { shared: { glbcShowFrom: '2027-01-15' } } }),
      TZ, new Date('2026-09-10T12:00:00Z')),
    allDay: true,
    startInstant: '2027-02-28T05:00:00.000Z',
    endInstant: '2027-03-01T05:00:00.000Z',
    isRecurringMaster: false,
  } as CalEvent, TZ);
  assert.equal(withDate.showFrom, '2027-01-15');

  const without = toPublicEvent({
    ...raw(),
    ...classify(raw(), TZ, new Date('2026-09-10T12:00:00Z')),
    allDay: true,
    startInstant: '2027-02-28T05:00:00.000Z',
    endInstant: '2027-03-01T05:00:00.000Z',
    isRecurringMaster: false,
  } as CalEvent, TZ);
  assert.equal('showFrom' in without, false, 'nothing to say means say nothing');
});

test('only the wall reads this date', () => {
  // Everything else carries on exactly as though it were not set: the website
  // lists the event, the feeds carry it, and its reminders run off its own
  // date. The furthest rung is thirty days, so a deadline entered months early
  // is not being reminded about yet anyway.
  for (const file of ['../src/ics.ts', '../src/remind.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal(src.includes('showFrom'), false, file + ' must not read this date');
  }
  assert.equal(SITE.includes('showFrom'), false, 'the website must not read this date');
  assert.ok(TV.includes('showFrom'), 'the wall is the one place that should');
});

// ---------------------------------------------------------------------------
// what the two pages do with it
// ---------------------------------------------------------------------------

const TV = readFileSync(new URL('../../site/tv.html', import.meta.url), 'utf8');
const SITE = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

test('the wall looks a fixed distance ahead', () => {
  // Without a horizon the rail took the whole calendar and put deadlines
  // first, so a fundraiser five months out led the wall above things
  // happening that week.
  assert.match(TV, /let TV_DAYS = 42;/);
  assert.ok(TV.includes('.filter(e => parse(e.start) <= horizon)'),
    'the rail no longer stops at a horizon');
  assert.ok(TV.includes('TV_DAYS = out.tvDays;'),
    'the horizon can no longer be changed without a deploy');
});

test('the wall hides it early and the website does not', () => {
  assert.ok(TV.includes('.filter(e => !notYet(e))'), 'the wall shows it too early');
  assert.equal(SITE.includes('notYetPublic'), false,
    'the website is meant to list everything on the calendar');
});

test('the wall has one heading, not two', () => {
  // "Don't forget" swapped in whenever anything was a deadline, so the heading
  // changed under a reader who had glanced away.
  assert.ok(TV.includes('$("railHead").textContent = "Coming up";'));
  assert.equal(TV.includes("Don't forget"), false);
});

// ---------------------------------------------------------------------------
// what a held-back event does to the reminders
// ---------------------------------------------------------------------------

test('a date on the wall does not silence the reminders', () => {
  // This is the case that was briefly broken: the thirty day rung for a
  // deadline whose wall date has not arrived. It must still go out.
  const sept4 = new Date('2026-09-04T09:00:00-04:00');
  const due = normalize({
    ministry: 'youth',
    id: 'f1',
    iCalUID: 'f1@google.com',
    status: 'confirmed',
    summary: 'DUE: Fundraiser money',
    start: { date: '2026-10-04' },
    end: { date: '2026-10-05' },
    extendedProperties: { shared: { glbcShowFrom: '2026-09-20' } },
  } as RawEvent, TZ, sept4);

  // Thirty days out, which is a rung on the deadline ladder.
  const held = planReminders({
    cfg, ministries: cfg.ministries, instances: [due], masters: [],
    state: { sent: {} }, now: sept4,
  });
  assert.equal(held.due.length, 1, 'the thirty day rung must still go out');
  assert.match(held.due[0].ruleId, /30/);

  // And the seven day rung later, as normal.
  const sept27 = new Date('2026-09-27T09:00:00-04:00');
  const open = planReminders({
    cfg, ministries: cfg.ministries, instances: [due], masters: [],
    state: { sent: {} }, now: sept27,
  });
  assert.equal(open.due.length, 1);
  assert.match(open.due[0].ruleId, /7/);
});

test('the weekly digest still mentions it', () => {
  // Sunday evening, with the event four days away and its wall date not yet
  // reached. The digest is about the week ahead, and it is in the week ahead.
  const sunday = new Date('2026-09-06T19:00:00-04:00');
  const soon = normalize({
    ministry: 'youth',
    id: 'f2',
    iCalUID: 'f2@google.com',
    status: 'confirmed',
    summary: 'Fundraiser kickoff',
    start: { date: '2026-09-10' },
    end: { date: '2026-09-11' },
    extendedProperties: { shared: { glbcShowFrom: '2026-09-20' } },
  } as RawEvent, TZ, sunday);

  const lines = planDigest({
    cfg, ministries: cfg.ministries, instances: [soon], masters: [],
    state: { sent: {} }, now: sunday,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /Fundraiser kickoff/);
});

// ---------------------------------------------------------------------------
// keeping something off the wall entirely
// ---------------------------------------------------------------------------

test('an event can be kept off the TV and nowhere else', () => {
  const out = classify(raw({
    extendedProperties: { shared: { glbcHideTv: 'true' } },
  }), TZ, new Date('2026-09-10T12:00:00Z'));
  assert.equal(out.hideFromTv, true);

  const plain = classify(raw(), TZ, new Date('2026-09-10T12:00:00Z'));
  assert.equal(plain.hideFromTv, false, 'off unless somebody asked for it');
});

test('the wall honours it and nothing else reads it', () => {
  assert.ok(TV.includes('.filter(e => !e.hideFromTv)'), 'the wall still shows it');
  assert.equal(SITE.includes('hideFromTv'), false, 'the website must not hide it');

  const remind = readFileSync(new URL('../src/remind.ts', import.meta.url), 'utf8');
  assert.equal(remind.includes('hideFromTv'), false, 'reminders must not read it');
});

test('the pin is carried through a save rather than dropped', () => {
  // The checkbox came off the form, but a save writes the whole event back.
  // Sending nothing would silently unpin anything pinned by hand.
  const ADMIN = readFileSync(new URL('../../site/admin.html', import.meta.url), 'utf8');
  assert.ok(ADMIN.includes('editingPinned = !!ev.pinned;'), 'the pin is not read back');
  assert.ok(ADMIN.includes('pinned: editingPinned,'), 'the pin is not sent back');
  assert.equal(ADMIN.includes('$("pinned")'), false, 'the pin checkbox is still there');
});

// ---------------------------------------------------------------------------
// the rail has to keep deciding whether it fits
// ---------------------------------------------------------------------------

test('a notice poll does not tear the rail down', () => {
  // The poll runs every two minutes. It used to rebuild the rail each time,
  // which replaced the crawl layer wholesale with nothing asking for the fit to
  // be checked again — so a list too long for the rail stopped moving within
  // two minutes and sat with its last row cut off.
  const at = TV.indexOf('async function loadNotice');
  assert.notEqual(at, -1, 'loadNotice is gone');
  const body = TV.slice(at, TV.indexOf('\n}\n', at));

  assert.ok(body.includes('out.tvDays !== TV_DAYS'),
    'the poll rebuilds the rail even when nothing changed');
  // Wherever the poll does rebuild, the fit has to be decided again after.
  const rebuild = body.indexOf('renderRail();');
  assert.ok(rebuild !== -1 && body.indexOf('layoutRail();', rebuild) !== -1,
    'the poll rebuilds the rail without laying it out again');
});

test('every rebuild of the rail is followed by a fresh fit check', () => {
  // renderRail replaces the list, which throws the crawl away. Anywhere it is
  // called, layoutRail has to follow, or the crawl silently stops.
  const script = [...TV.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const calls = [...script.matchAll(/renderRail\(\);/g)].map((m) => m.index!);
  assert.ok(calls.length >= 2, 'expected the initial draw and the poll');
  for (const at of calls) {
    const after = script.slice(at, at + 400);
    assert.ok(after.includes('layoutRail();'),
      'a renderRail() call is not followed by layoutRail(): ' + script.slice(at - 60, at + 20));
  }
});

test('the rail refits when the screen changes under it', () => {
  // Opened on a laptop, dragged to the TV, F11: each changes the rail's size
  // after the one decision that used to be made at load.
  assert.ok(TV.includes('new ResizeObserver(refitSoon).observe($("rail"))'),
    'the rail is not watched for size changes');
  assert.ok(TV.includes('window.addEventListener("resize", refitSoon)'),
    'a window resize does not refit');
  assert.ok(TV.includes('document.addEventListener("fullscreenchange", refitSoon)'),
    'going fullscreen does not refit');
  // The church's fonts arrive after the fallback text was measured.
  assert.ok(TV.includes('document.fonts.ready.then'),
    'the rail is measured before the real fonts are in');
});
