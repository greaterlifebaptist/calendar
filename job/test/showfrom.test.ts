import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, parseFields } from '../src/classify.ts';
import { toPublicEvent } from '../src/publish.ts';
import type { RawEvent, CalEvent } from '../src/types.ts';

/**
 * "Start showing it on": a date before which an event is not public.
 *
 * For something real but not yet relevant — a fundraiser deadline entered four
 * months early so it is not forgotten, which has no business on the foyer wall
 * until the fundraiser starts.
 *
 * A rule that hides things is the kind that fails quietly, in both directions:
 * hiding what should show is invisible until somebody misses it, and failing
 * to hide is only noticed by whoever is annoyed by the wall.
 */
const TZ = 'America/New_York';

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

test('it changes what is shown, never what is sent or subscribed', () => {
  // A subscribed calendar that quietly omitted a date it knew about would be
  // worse than an early one, and a reminder is governed by the event date.
  const remind = readFileSync(new URL('../src/remind.ts', import.meta.url), 'utf8');
  assert.equal(remind.includes('showFrom'), false,
    'the reminder ladder must not read this date');

  const ics = readFileSync(new URL('../src/ics.ts', import.meta.url), 'utf8');
  assert.equal(ics.includes('showFrom'), false,
    'the .ics feeds must not read this date');
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
  assert.ok(TV.includes('if (out.tvDays) TV_DAYS = out.tvDays;'),
    'the horizon can no longer be changed without a deploy');
});

test('both pages hide what is not meant to be public yet', () => {
  assert.ok(TV.includes('.filter(e => !notYet(e))'), 'the wall shows it early');
  assert.ok(SITE.includes('.filter(e => !notYetPublic(e))'), 'the website shows it early');
  // The month grid is a separate pass over the same data and was missed once.
  assert.equal(SITE.split('!notYetPublic(e)').length - 1, 2,
    'the agenda and the month grid must both filter');
});

test('the wall has one heading, not two', () => {
  // "Don't forget" swapped in whenever anything was a deadline, so the heading
  // changed under a reader who had glanced away.
  assert.ok(TV.includes('$("railHead").textContent = "Coming up";'));
  assert.equal(TV.includes("Don't forget"), false);
});
