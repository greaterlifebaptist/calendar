/**
 * Event classification. See CLAUDE.md section 5.
 *
 * The governing constraint: a leader adding an event at 9pm on their phone
 * types a title and a time and nothing else. Inference has to carry the load.
 * Prefixes exist only to correct inference, and the admin form writes explicit
 * extended properties. All three paths must land on the same shape.
 *
 * Precedence, highest first:
 *   1. extended properties  (admin form wrote them deliberately)
 *   2. title prefix         (a leader typed DUE:/PIN:/NOPIN: on purpose)
 *   3. inference            (nobody said anything)
 */

import type { RawEvent, Classified, EventType } from './types.ts';
import { daysBetween, startOfDate } from './time.ts';

/** Words that mean "something is owed by this date". */
const DEADLINE_RE =
  /\b(due|deadline|deposit|forms?|rsvp|sign[- ]?up|signups?|last day|turn in|money)\b/i;

/** Auto-pin trips and deadlines further out than this many days. */
export const PIN_HORIZON_DAYS = 60;

const VALID_TYPES: EventType[] = ['deadline', 'trip', 'routine', 'event'];

type PrefixResult = {
  title: string;
  forceType: EventType | null;
  forcePinned: boolean | null;
};

/**
 * Strip leading override markers. Handles several in a row
 * ("PIN: DUE: Trip deposit") because people will type them that way.
 *
 * DUE:/PIN:/NOPIN: are the documented three. EVENT:/TRIP:/ROUTINE: exist
 * because the keyword rule has false positives with no other escape hatch:
 * "Money counters meeting" is not a deadline, and DUE: cannot un-say that.
 */
export function stripPrefixes(rawTitle: string): PrefixResult {
  let title = (rawTitle ?? '').trim();
  let forceType: EventType | null = null;
  let forcePinned: boolean | null = null;

  for (;;) {
    const m = /^(due|pin|nopin|event|trip|routine)\s*:\s*/i.exec(title);
    if (!m) break;
    const tag = m[1].toLowerCase();
    if (tag === 'due') forceType = 'deadline';
    else if (tag === 'event') forceType = 'event';
    else if (tag === 'trip') forceType = 'trip';
    else if (tag === 'routine') forceType = 'routine';
    else if (tag === 'pin') forcePinned = true;
    else if (tag === 'nopin') forcePinned = false;
    title = title.slice(m[0].length).trim();
  }

  return { title, forceType, forcePinned };
}

/** Google's web editor stores rich text; phones store plain. Normalise both. */
export function toPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\u2022 ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Fields = {
  notes: string;
  cost: string | null;
  link: string | null;
  linkText: string | null;
  contact: string | null;
};

/**
 * Pull optional `cost:` / `link:` / `contact:` lines out of the description.
 * Never required. Anything unrecognised stays in the notes verbatim.
 */
export function parseFields(description: string): Fields {
  const text = toPlainText(description ?? '');
  const keep: string[] = [];
  let cost: string | null = null;
  let link: string | null = null;
  let linkText: string | null = null;
  let contact: string | null = null;

  for (const line of text.split('\n')) {
    const m = /^\s*(cost|link|contact)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) {
      keep.push(line);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'cost' && !cost) cost = value;
    if (key === 'contact' && !contact) contact = value;
    if (key === 'link' && !link) {
      // "link: Permission form https://..." — split label from URL.
      const urlMatch = /(https?:\/\/\S+)/i.exec(value);
      if (urlMatch) {
        link = urlMatch[1];
        const label = value.replace(urlMatch[1], '').replace(/[\s|—–-]+$/, '').trim();
        linkText = label || null;
      } else {
        link = value;
      }
    }
  }

  return {
    notes: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    cost,
    link,
    linkText,
    contact,
  };
}

/**
 * True when the RRULE repeats weekly, biweekly or daily.
 *
 * No longer used for classification. The reminder engine uses it to throttle
 * a frequent series: a monthly meeting can take the full ladder, an eight week
 * Wednesday class reminding a week ahead every week is just noise.
 */
export function isWeeklyish(recurrence: string[] | undefined): boolean {
  if (!recurrence?.length) return false;
  for (const line of recurrence) {
    const rule = /^RRULE:(.*)$/i.exec(line.trim());
    if (!rule) continue;
    const parts = new Map<string, string>();
    for (const pair of rule[1].split(';')) {
      const [k, v] = pair.split('=');
      if (k) parts.set(k.trim().toUpperCase(), (v ?? '').trim().toUpperCase());
    }
    const freq = parts.get('FREQ');
    const interval = Number(parts.get('INTERVAL') ?? '1');
    if (freq === 'DAILY') return true;
    if (freq === 'WEEKLY' && interval <= 2) return true;
  }
  return false;
}

/** Whole-day span of an all-day event. Google's end date is exclusive. */
export function allDaySpan(ev: RawEvent, tz: string): number {
  if (!ev.start.date) return 0;
  const startD = startOfDate(ev.start.date, tz);
  const endD = ev.end?.date ? startOfDate(ev.end.date, tz) : startD;
  return Math.max(1, daysBetween(startD, endD, tz));
}

function readProp(ev: RawEvent, key: string): string | undefined {
  return ev.extendedProperties?.shared?.[key] ?? ev.extendedProperties?.private?.[key];
}

/**
 * Classify one event. `now` is injected so the 60-day pin horizon is testable.
 */
export function classify(ev: RawEvent, tz: string, now: Date = new Date()): Classified {
  const { title, forceType, forcePinned } = stripPrefixes(ev.summary ?? '');
  const fields = parseFields(ev.description ?? '');

  const propType = readProp(ev, 'glbcType');
  const propPinned = readProp(ev, 'glbcPinned');

  const explicitType =
    propType && (VALID_TYPES as string[]).includes(propType.toLowerCase())
      ? (propType.toLowerCase() as EventType)
      : null;

  const explicitPinned =
    propPinned === undefined ? null : /^(1|true|yes|x)$/i.test(propPinned.trim());

  const allDay = Boolean(ev.start.date);
  const span = allDaySpan(ev, tz);

  // ---- type ----
  let type: EventType;
  let reason: string;

  if (explicitType) {
    type = explicitType;
    reason = 'extended-property';
  } else if (forceType) {
    type = forceType;
    reason = 'prefix';
  } else if (DEADLINE_RE.test(title)) {
    type = 'deadline';
    reason = 'title-keyword';
  } else if (allDay && span >= 2) {
    type = 'trip';
    reason = 'multi-day-all-day';
  } else {
    // Deliberately NOT demoting recurring events to `routine`.
    //
    // That rule assumed these calendars would carry the normal Sunday and
    // Thursday rhythm, which they do not. Only things people need to pay
    // attention to go on them, and a weekly series here is usually a
    // six-week class or a short run of practices: exactly the kind of thing
    // somebody needs reminding about. Demoting it would hide it from the
    // pinned rail and silence its reminders, and would need a tag to undo,
    // which is the one thing this classifier exists to avoid.
    //
    // `routine` still exists for a genuine standing fixture, but it has to be
    // asked for now, with a ROUTINE: prefix or the admin form.
    type = 'event';
    reason = 'default';
  }

  // ---- pinned ----
  const startInstant = ev.start.date
    ? startOfDate(ev.start.date, tz)
    : new Date(ev.start.dateTime ?? now.toISOString());
  const daysOut = daysBetween(now, startInstant, tz);

  let pinned: boolean;
  if (explicitPinned !== null) {
    pinned = explicitPinned;
  } else if (forcePinned !== null) {
    pinned = forcePinned;
  } else if (type === 'routine') {
    pinned = false;
  } else if (type === 'trip' && allDay && span >= 2) {
    pinned = true;
  } else if ((type === 'trip' || type === 'deadline') && daysOut > PIN_HORIZON_DAYS) {
    pinned = true;
  } else {
    pinned = false;
  }

  return { type, pinned, title, reason, ...fields };
}
