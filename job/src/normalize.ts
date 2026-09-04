/** RawEvent -> CalEvent: resolve instants, run the classifier, drop noise. */

import type { CalEvent, RawEvent } from './types.ts';
import { classify } from './classify.ts';
import { startOfDate } from './time.ts';

function instant(
  part: { date?: string; dateTime?: string } | undefined,
  tz: string,
  fallback: Date,
): Date {
  if (part?.dateTime) return new Date(part.dateTime);
  if (part?.date) return startOfDate(part.date, tz);
  return fallback;
}

export function normalize(raw: RawEvent, tz: string, now: Date = new Date()): CalEvent {
  const allDay = Boolean(raw.start?.date);
  const startInstant = instant(raw.start, tz, now);
  const endInstant = instant(raw.end, tz, startInstant);
  const classified = classify(raw, tz, now);

  return {
    ...raw,
    ...classified,
    allDay,
    startInstant: startInstant.toISOString(),
    endInstant: endInstant.toISOString(),
    isRecurringMaster: Boolean(raw.recurrence?.length),
  };
}

export function normalizeAll(raws: RawEvent[], tz: string, now: Date = new Date()): CalEvent[] {
  return raws.map((r) => normalize(r, tz, now));
}

/**
 * Google can return the same occurrence twice across paged reads. Keep the
 * later `updated` stamp so an edit made mid-run does not lose to a stale copy.
 */
export function dedupe(events: CalEvent[]): CalEvent[] {
  const byKey = new Map<string, CalEvent>();
  for (const ev of events) {
    const key = ev.ministry + '|' + (ev.id || ev.iCalUID) + '|' + ev.startInstant;
    const prior = byKey.get(key);
    if (!prior || (ev.updated ?? '') >= (prior.updated ?? '')) byKey.set(key, ev);
  }
  return [...byKey.values()];
}

export function byStart(a: CalEvent, b: CalEvent): number {
  if (a.startInstant !== b.startInstant) return a.startInstant < b.startInstant ? -1 : 1;
  return a.title.localeCompare(b.title);
}
