import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMonths, linesFor } from '../src/card.ts';
import { normalize } from '../src/normalize.ts';
import { loadConfig } from '../src/config.ts';
import type { CalEvent, RawEvent } from '../src/types.ts';

const cfg = loadConfig();
const TZ = cfg.timezone;

const name = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

test('a card covers the two months after the one it is made in', () => {
  // Generated on the 1st and on the 16th of the same month must agree: the
  // card is for the months ahead, not for wherever the run happens to land.
  for (const day of ['01', '16', '28']) {
    const months = cardMonths(new Date(`2026-09-${day}T12:00:00-04:00`), TZ);
    assert.deepEqual(months.map(name), ['2026-10', '2026-11'], 'generated on the ' + day);
  }
});

test('the year rolls over between the two months', () => {
  // Generated in November: December and then January of the NEXT year. This is
  // the one that would be found the hard way, in December, with cards printed.
  assert.deepEqual(
    cardMonths(new Date('2026-11-16T12:00:00-05:00'), TZ).map(name),
    ['2026-12', '2027-01'],
  );
});

test('the year rolls over before the first month too', () => {
  assert.deepEqual(
    cardMonths(new Date('2026-12-16T12:00:00-05:00'), TZ).map(name),
    ['2027-01', '2027-02'],
  );
});

function ev(ministry: string, date: string, type: string, summary = 'Thing'): CalEvent {
  return normalize(
    {
      ministry, id: date + type, iCalUID: date + type + '@google.com', status: 'confirmed',
      summary,
      start: { dateTime: date + 'T19:00:00-05:00' },
      end: { dateTime: date + 'T20:00:00-05:00' },
      extendedProperties: { shared: { glbcType: type } },
    } as RawEvent,
    TZ,
    new Date('2026-11-16T12:00:00-05:00'),
  );
}

test('January 2027 does not collect January 2026 events', () => {
  const months = cardMonths(new Date('2026-11-16T12:00:00-05:00'), TZ);
  const events = [ev('church', '2027-01-10', 'event', 'Right year'),
                  ev('church', '2026-01-10', 'event', 'Wrong year')];
  const lines = linesFor(events, months[1]!, new Set(['church']));
  assert.deepEqual(lines.map((l) => l.title), ['Right year']);
});

test('routine events never reach the card', () => {
  const months = cardMonths(new Date('2026-09-16T12:00:00-04:00'), TZ);
  const events = [ev('church', '2026-10-01', 'routine', 'Supper served'),
                  ev('church', '2026-10-02', 'event', 'Fall festival')];
  const lines = linesFor(events, months[0]!, new Set(['church']));
  assert.deepEqual(lines.map((l) => l.title), ['Fall festival']);
});

test('private ministries never reach the card', () => {
  const months = cardMonths(new Date('2026-09-16T12:00:00-04:00'), TZ);
  const events = [ev('youth-leaders', '2026-10-05', 'event', 'Leaders meeting'),
                  ev('church', '2026-10-06', 'event', 'Business meeting')];
  const lines = linesFor(events, months[0]!, new Set(['church', 'youth']));
  assert.deepEqual(lines.map((l) => l.title), ['Business meeting']);
});
