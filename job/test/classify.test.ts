import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, stripPrefixes, parseFields, isWeeklyish, toPlainText } from '../src/classify.ts';
import type { RawEvent } from '../src/types.ts';

const TZ = 'America/New_York';
/** Fixed "now" so the 60-day pin horizon is deterministic. */
const NOW = new Date('2026-09-04T12:00:00-04:00');

function ev(patch: Partial<RawEvent>): RawEvent {
  return {
    ministry: 'youth',
    id: 'x',
    iCalUID: 'x@google.com',
    status: 'confirmed',
    summary: 'Untitled',
    start: { dateTime: '2026-09-20T19:00:00-04:00' },
    end: { dateTime: '2026-09-20T20:00:00-04:00' },
    ...patch,
  };
}

function timed(summary: string, startIso = '2026-09-20T19:00:00-04:00'): RawEvent {
  return ev({ summary, start: { dateTime: startIso }, end: { dateTime: startIso } });
}

function allDay(summary: string, start: string, end?: string): RawEvent {
  return ev({ summary, start: { date: start }, end: { date: end ?? start } });
}

// ---------------------------------------------------------------------------
// The table that matters: titles leaders actually type, and what they must mean.
// ---------------------------------------------------------------------------

const TITLE_CASES: [string, string][] = [
  // Deadline keywords
  ['Permission forms due - Pigeon Forge', 'deadline'],
  ['permission form due', 'deadline'],
  ['raffle money and unsold tickets due', 'deadline'],
  ['Trip deposit $75', 'deadline'],
  ['Deadline for camp registration', 'deadline'],
  ['RSVP for the banquet', 'deadline'],
  ['Sign up for the fall festival', 'deadline'],
  ['Signup sheet closes', 'deadline'],
  ['Sign-up for nursery rotation', 'deadline'],
  ['Last day to order shirts', 'deadline'],
  ['Turn in your fundraiser money', 'deadline'],

  // Plain events: no keyword anywhere
  ['Gun raffle drawing', 'event'],
  ['Youth fundraiser car wash', 'event'],
  ['Deacons meeting', 'event'],
  ['Fifth Sunday singing & dinner on the grounds', 'event'],
  ['Mens breakfast', 'event'],
  ['Revival - Night 1', 'event'],
  ['See You at the Pole', 'event'],
  ['Fall Festival', 'event'],
  ['Homecoming', 'event'],

  // Words that merely contain a keyword must not trip the rule.
  ['Uniform handout', 'event'],
  ['Dueling pianos night', 'event'],
  ['Informal potluck', 'event'],
];

test('title inference matches what leaders mean', () => {
  for (const [title, expected] of TITLE_CASES) {
    const got = classify(timed(title), TZ, NOW);
    assert.equal(got.type, expected, `"${title}" classified as ${got.type} via ${got.reason}`);
  }
});

test('multi-day all-day events are trips and are pinned', () => {
  const trip = classify(allDay('Youth trip - Pigeon Forge, TN', '2027-07-12', '2027-07-18'), TZ, NOW);
  assert.equal(trip.type, 'trip');
  assert.equal(trip.pinned, true);
});

test('a single all-day event is not a trip', () => {
  const c = classify(allDay('Church workday', '2026-10-17', '2026-10-18'), TZ, NOW);
  assert.equal(c.type, 'event');
  assert.equal(c.pinned, false);
});

test('a recurring event is an ordinary event, not demoted to routine', () => {
  // These calendars carry only what people need to pay attention to. A weekly
  // series here is a short run of classes or revival nights, not the standing
  // Sunday service, so it must behave like any other event and be reminded
  // about without anyone having to tag it.
  for (const rule of [
    'RRULE:FREQ=WEEKLY;BYDAY=TH',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU',
    'RRULE:FREQ=DAILY;COUNT=4',
    'RRULE:FREQ=MONTHLY;BYDAY=2TU',
  ]) {
    const c = classify(ev({ summary: 'Revival', recurrence: [rule] }), TZ, NOW);
    assert.equal(c.type, 'event', rule);
    assert.equal(c.reason, 'default', rule);
  }
});

test('a recurring deadline is still a deadline', () => {
  const c = classify(
    ev({ summary: 'Fundraiser money due', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU'] }),
    TZ,
    NOW,
  );
  assert.equal(c.type, 'deadline');
});

test('routine still exists, but has to be asked for', () => {
  const c = classify(
    ev({ summary: 'ROUTINE: Sunday morning worship', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU'] }),
    TZ,
    NOW,
  );
  assert.equal(c.type, 'routine');
  assert.equal(c.title, 'Sunday morning worship');
  assert.equal(c.pinned, false, 'a standing fixture is never pinned');
});

test('deadlines beyond the 60 day horizon pin themselves', () => {
  const near = classify(allDay('Forms due', '2026-09-30', '2026-10-01'), TZ, NOW);
  const far = classify(allDay('Trip deposit due', '2027-02-14', '2027-02-15'), TZ, NOW);
  assert.equal(near.type, 'deadline');
  assert.equal(near.pinned, false, 'a deadline inside the visible window needs no pin');
  assert.equal(far.type, 'deadline');
  assert.equal(far.pinned, true);
});

test('the 60 day horizon is exclusive at the boundary', () => {
  // NOW is 2026-09-04, so +60d is 2026-11-03 and +61d is 2026-11-04.
  const at60 = classify(allDay('Forms due', '2026-11-03', '2026-11-04'), TZ, NOW);
  const at61 = classify(allDay('Forms due', '2026-11-04', '2026-11-05'), TZ, NOW);
  assert.equal(at60.pinned, false);
  assert.equal(at61.pinned, true);
});

test('a plain event far out is not auto-pinned', () => {
  const c = classify(timed('Homecoming', '2027-05-16T10:00:00-04:00'), TZ, NOW);
  assert.equal(c.type, 'event');
  assert.equal(c.pinned, false, 'only trips and deadlines auto-pin');
});

// ---------------------------------------------------------------------------
// Prefix overrides
// ---------------------------------------------------------------------------

test('prefixes are stripped from the displayed title', () => {
  assert.equal(stripPrefixes('DUE: Forms').title, 'Forms');
  assert.equal(stripPrefixes('PIN:  Homecoming').title, 'Homecoming');
  assert.equal(stripPrefixes('NOPIN: Retreat').title, 'Retreat');
  assert.equal(stripPrefixes('due:forms').title, 'forms');
  assert.equal(stripPrefixes('PIN: DUE: Trip deposit').title, 'Trip deposit');
});

test('DUE: forces a deadline on a title with no keyword', () => {
  const c = classify(timed('DUE: Shirt orders'), TZ, NOW);
  assert.equal(c.type, 'deadline');
  assert.equal(c.reason, 'prefix');
  assert.equal(c.title, 'Shirt orders');
});

test('EVENT: rescues a false positive from the keyword rule', () => {
  const bare = classify(timed('Money counters meeting'), TZ, NOW);
  assert.equal(bare.type, 'deadline', 'the word "money" is what makes this a false positive');
  const fixed = classify(timed('EVENT: Money counters meeting'), TZ, NOW);
  assert.equal(fixed.type, 'event');
  assert.equal(fixed.title, 'Money counters meeting');
});

test('PIN: and NOPIN: beat the automatic rules', () => {
  const pinned = classify(timed('PIN: Homecoming', '2027-05-16T10:00:00-04:00'), TZ, NOW);
  assert.equal(pinned.pinned, true);

  const unpinned = classify(allDay('NOPIN: Leaders planning retreat', '2027-01-16', '2027-01-18'), TZ, NOW);
  assert.equal(unpinned.type, 'trip');
  assert.equal(unpinned.pinned, false);
});

// ---------------------------------------------------------------------------
// Admin form path: extended properties must land where prefixes land.
// ---------------------------------------------------------------------------

test('extended properties outrank both prefix and inference', () => {
  const c = classify(
    ev({
      summary: 'DUE: Shirt orders',
      extendedProperties: { shared: { glbcType: 'event', glbcPinned: 'false' } },
    }),
    TZ,
    NOW,
  );
  assert.equal(c.type, 'event');
  assert.equal(c.pinned, false);
  assert.equal(c.reason, 'extended-property');
});

test('the admin form and a prefix produce the same result', () => {
  const viaPrefix = classify(timed('DUE: Shirt orders'), TZ, NOW);
  const viaForm = classify(
    ev({
      summary: 'Shirt orders',
      start: { dateTime: '2026-09-20T19:00:00-04:00' },
      end: { dateTime: '2026-09-20T19:00:00-04:00' },
      extendedProperties: { private: { glbcType: 'deadline' } },
    }),
    TZ,
    NOW,
  );
  assert.equal(viaPrefix.type, viaForm.type);
  assert.equal(viaPrefix.pinned, viaForm.pinned);
  assert.equal(viaPrefix.title, viaForm.title);
});

test('an unrecognised glbcType falls back to inference', () => {
  const c = classify(
    ev({ summary: 'Forms due', extendedProperties: { shared: { glbcType: 'banana' } } }),
    TZ,
    NOW,
  );
  assert.equal(c.type, 'deadline');
  assert.equal(c.reason, 'title-keyword');
});

// ---------------------------------------------------------------------------
// Description parsing
// ---------------------------------------------------------------------------

test('cost, link and contact are lifted out of the notes', () => {
  const f = parseFields(
    'Bring a sleeping bag.\ncost: $10\nlink: Permission form https://example.org/f\ncontact: Bro. Spencer',
  );
  assert.equal(f.cost, '$10');
  assert.equal(f.link, 'https://example.org/f');
  assert.equal(f.linkText, 'Permission form');
  assert.equal(f.contact, 'Bro. Spencer');
  assert.equal(f.notes, 'Bring a sleeping bag.');
});

test('a bare URL link needs no label', () => {
  const f = parseFields('link: https://example.org/f');
  assert.equal(f.link, 'https://example.org/f');
  assert.equal(f.linkText, null);
});

test('unrecognised description text is preserved verbatim', () => {
  const f = parseFields('Drop off Friday 8pm.\nPick up Saturday 8am.');
  assert.equal(f.notes, 'Drop off Friday 8pm.\nPick up Saturday 8am.');
  assert.equal(f.cost, null);
});

test('HTML from the Google web editor becomes plain text', () => {
  assert.equal(
    toPlainText('<p>Teens sit up front.<br>Pizza afterward.</p>'),
    'Teens sit up front.\nPizza afterward.',
  );
  assert.equal(toPlainText('Bob &amp; Sue&#39;s house'), "Bob & Sue's house");
});

test('missing summary and description do not throw', () => {
  const c = classify(ev({ summary: undefined, description: undefined }), TZ, NOW);
  assert.equal(c.title, '');
  assert.equal(c.notes, '');
  assert.equal(c.type, 'event');
});

// ---------------------------------------------------------------------------

test('isWeeklyish reads FREQ and INTERVAL', () => {
  assert.equal(isWeeklyish(['RRULE:FREQ=WEEKLY']), true);
  assert.equal(isWeeklyish(['RRULE:FREQ=WEEKLY;INTERVAL=2']), true);
  assert.equal(isWeeklyish(['RRULE:FREQ=WEEKLY;INTERVAL=3']), false);
  assert.equal(isWeeklyish(['RRULE:FREQ=MONTHLY']), false);
  assert.equal(isWeeklyish(['RRULE:FREQ=YEARLY']), false);
  assert.equal(isWeeklyish(undefined), false);
  assert.equal(isWeeklyish(['EXDATE;TZID=America/New_York:20261126T190000']), false);
});
