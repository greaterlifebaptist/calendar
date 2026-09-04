/**
 * ICS (RFC 5545) generation.
 *
 * Two rules drive the shape of this file:
 *  - Recurring events keep their RRULE. Never expand a weekly service into
 *    hundreds of VEVENTs (CLAUDE.md section 10).
 *  - Timed events are written in local time with a TZID, not UTC. A UTC
 *    DTSTART on a weekly 7pm meeting drifts an hour every time the clocks
 *    change; a TZID plus a VTIMEZONE does not.
 */

import type { CalEvent, Config, Ministry } from './types.ts';
import { icsDate, icsLocal, icsUtc } from './time.ts';

const CRLF = '\r\n';
const PRODID = '-//Greater Life Baptist Church//GLBC Calendar//EN';

/** America/New_York, expressed with the post-2007 US DST rules. */
const VTIMEZONE_NY = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'X-LIC-LOCATION:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Fold to 75 octets per line, continuing with a single leading space. */
export function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return out.join(CRLF + ' ');
}

export function escapeText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

class Lines {
  readonly rows: string[] = [];

  add(name: string, value: string, params: Record<string, string> = {}): void {
    if (value === '' || value === undefined || value === null) return;
    const p = Object.entries(params)
      .map(([k, v]) => ';' + k + '=' + v)
      .join('');
    this.rows.push(fold(name + p + ':' + value));
  }

  raw(line: string): void {
    if (line) this.rows.push(fold(line));
  }
}

type DtValue = { value: string; params: Record<string, string> };

function dtStart(ev: CalEvent, tz: string): DtValue {
  if (ev.allDay) return { value: icsDate(ev.start.date!), params: { VALUE: 'DATE' } };
  return { value: icsLocal(new Date(ev.startInstant), tz), params: { TZID: tz } };
}

function dtEnd(ev: CalEvent, tz: string): DtValue | null {
  if (ev.allDay) {
    // Google's all-day end date is already exclusive, matching RFC 5545.
    const end = ev.end?.date ?? ev.start.date!;
    return { value: icsDate(end), params: { VALUE: 'DATE' } };
  }
  if (!ev.end?.dateTime) return null;
  return { value: icsLocal(new Date(ev.endInstant), tz), params: { TZID: tz } };
}

/** Rebuild a human description, folding the parsed fields back in. */
function describe(ev: CalEvent): string {
  const parts: string[] = [];
  if (ev.notes) parts.push(ev.notes);
  const tail: string[] = [];
  if (ev.cost) tail.push('Cost: ' + ev.cost);
  if (ev.contact) tail.push('Contact: ' + ev.contact);
  if (ev.link) tail.push((ev.linkText ?? 'Details') + ': ' + ev.link);
  if (tail.length) parts.push(tail.join('\n'));
  return parts.join('\n\n');
}

export type IcsInput = {
  event: CalEvent;
  /** Cancelled occurrences of this recurring series, as EXDATE-ready values. */
  exdates?: string[];
  /** Present on an occurrence that overrides its series. */
  recurrenceId?: DtValue;
};

function vevent(input: IcsInput, tz: string, stamp: string): string[] {
  const ev = input.event;
  const l = new Lines();
  const start = dtStart(ev, tz);
  const end = dtEnd(ev, tz);

  l.raw('BEGIN:VEVENT');
  l.add('UID', ev.iCalUID || ev.id + '@greaterlifebaptistchurch.com');
  l.add('DTSTAMP', stamp);
  l.add('DTSTART', start.value, start.params);
  if (end) l.add('DTEND', end.value, end.params);
  if (input.recurrenceId) {
    l.add('RECURRENCE-ID', input.recurrenceId.value, input.recurrenceId.params);
  }
  l.add('SUMMARY', escapeText(ev.title));
  const desc = describe(ev);
  if (desc) l.add('DESCRIPTION', escapeText(desc));
  if (ev.location) l.add('LOCATION', escapeText(ev.location));
  if (ev.link) l.add('URL', ev.link);
  l.add('CATEGORIES', escapeText(ev.type.toUpperCase()));
  l.add('X-GLBC-MINISTRY', escapeText(ev.ministry));
  l.add('X-GLBC-TYPE', escapeText(ev.type));
  if (ev.pinned) l.add('X-GLBC-PINNED', 'TRUE');
  if (ev.created) l.add('CREATED', icsUtc(new Date(ev.created)));
  if (ev.updated) l.add('LAST-MODIFIED', icsUtc(new Date(ev.updated)));
  if (typeof ev.sequence === 'number') l.add('SEQUENCE', String(ev.sequence));

  for (const line of ev.recurrence ?? []) {
    const trimmed = line.trim();
    if (/^(RRULE|RDATE|EXDATE)[;:]/i.test(trimmed)) l.raw(trimmed);
  }
  if (input.exdates?.length) {
    const params = ev.allDay ? ';VALUE=DATE' : ';TZID=' + tz;
    l.raw('EXDATE' + params + ':' + input.exdates.join(','));
  }

  l.add('TRANSP', ev.allDay ? 'TRANSPARENT' : 'OPAQUE');
  l.raw('END:VEVENT');
  return l.rows;
}

export type CalendarMeta = { name: string; description?: string };

/** Wrap VEVENTs in a VCALENDAR with the timezone definition. */
export function buildIcs(inputs: IcsInput[], cfg: Config, meta: CalendarMeta): string {
  const tz = cfg.timezone;
  const stamp = icsUtc(new Date());
  const rows: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + escapeText(meta.name)),
    'X-WR-TIMEZONE:' + tz,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  if (meta.description) rows.push(fold('X-WR-CALDESC:' + escapeText(meta.description)));
  rows.push(...VTIMEZONE_NY);
  for (const input of inputs) rows.push(...vevent(input, tz, stamp));
  rows.push('END:VCALENDAR');
  return rows.join(CRLF) + CRLF;
}

/**
 * Turn a ministry's recurrence masters into ICS inputs: attach cancelled
 * occurrences as EXDATEs and emit modified occurrences with a RECURRENCE-ID.
 */
export function toIcsInputs(events: CalEvent[], tz: string): IcsInput[] {
  const byId = new Map<string, CalEvent>();
  for (const ev of events) if (ev.id) byId.set(ev.id, ev);

  const exdates = new Map<string, string[]>();
  for (const ev of events) {
    if (!ev.recurringEventId || ev.status !== 'cancelled') continue;
    const master = byId.get(ev.recurringEventId);
    if (!master) continue;
    const original = ev.originalStartTime ?? ev.start;
    const value = original.date
      ? icsDate(original.date)
      : icsLocal(new Date(original.dateTime!), tz);
    const list = exdates.get(master.id) ?? [];
    list.push(value);
    exdates.set(master.id, list);
  }

  const inputs: IcsInput[] = [];
  for (const ev of events) {
    if (ev.status === 'cancelled') continue;

    if (ev.recurringEventId) {
      const master = byId.get(ev.recurringEventId);
      if (!master) {
        // Series master falls outside the fetch window; publish standalone.
        inputs.push({ event: ev });
        continue;
      }
      const original = ev.originalStartTime ?? ev.start;
      const recurrenceId: DtValue = original.date
        ? { value: icsDate(original.date), params: { VALUE: 'DATE' } }
        : { value: icsLocal(new Date(original.dateTime!), tz), params: { TZID: tz } };
      // An overridden occurrence belongs to its series: same UID, and the
      // series' classification, since the override carries no RRULE of its own.
      inputs.push({
        event: {
          ...ev,
          iCalUID: master.iCalUID || ev.iCalUID,
          type: master.type,
          pinned: master.pinned,
        },
        recurrenceId,
      });
      continue;
    }

    inputs.push({ event: ev, exdates: exdates.get(ev.id) });
  }

  return inputs;
}

export function ministryCalendarName(m: Ministry): string {
  return 'GLBC — ' + m.name;
}
