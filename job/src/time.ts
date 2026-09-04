/**
 * Timezone helpers. Everything the church cares about happens in
 * America/New_York, but the job runs on GitHub Actions in UTC, so no code
 * outside this file may use the host's local timezone.
 */

type Parts = { y: number; m: number; d: number; H: number; M: number; S: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock calendar parts for an instant, as seen in `tz`. */
export function zonedParts(instant: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  // Intl renders midnight as hour 24 in some ICU versions.
  const H = out.hour === 24 ? 0 : out.hour;
  return { y: out.year, m: out.month, d: out.day, H, M: out.minute, S: out.second };
}

/** Milliseconds to add to a UTC instant to reach `tz` wall clock. */
function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - instant.getTime();
}

/** The instant at which `tz` reads the given wall clock. */
export function fromWallClock(
  y: number, m: number, d: number, H: number, M: number, S: number, tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, H, M, S);
  let ts = guess - offsetMs(new Date(guess), tz);
  // One refinement pass settles times that straddle a DST transition.
  ts = guess - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Midnight local in `tz` on a YYYY-MM-DD date string. */
export function startOfDate(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return fromWallClock(y, m, d, 0, 0, 0, tz);
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** ICS floating/local form: 20260906T190000 */
export function icsLocal(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.y}${p2(p.m)}${p2(p.d)}T${p2(p.H)}${p2(p.M)}${p2(p.S)}`;
}

/** ICS UTC form: 20260906T230000Z */
export function icsUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** ICS DATE form: 20260906 */
export function icsDate(ymd: string): string {
  return ymd.replace(/-/g, '');
}

/** A whole-day index in `tz`, for calendar-day arithmetic. */
export function dayIndex(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}

/** Whole calendar days from `from` to `to`, counted in `tz`. */
export function daysBetween(from: Date, to: Date, tz: string): number {
  return dayIndex(to, tz) - dayIndex(from, tz);
}

/** YYYY-MM-DD as seen in `tz`. */
export function isoDate(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

/** Local wall clock without an offset: 2026-09-06T19:00:00 */
export function isoLocal(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.H)}:${p2(p.M)}:${p2(p.S)}`;
}

/** Add whole months to an instant, keeping the local day of month. */
export function addMonths(instant: Date, months: number, tz: string): Date {
  const p = zonedParts(instant, tz);
  const total = (p.y * 12) + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fromWallClock(y, m, Math.min(p.d, lastDay), p.H, p.M, p.S, tz);
}

/** Midnight local on the first day of the month containing `instant`. */
export function startOfMonth(instant: Date, tz: string): Date {
  const p = zonedParts(instant, tz);
  return fromWallClock(p.y, p.m, 1, 0, 0, 0, tz);
}
