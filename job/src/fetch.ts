/**
 * Google Calendar API -> normalized events.
 *
 * Each calendar is read twice, deliberately:
 *
 *  - "instances" (singleEvents=true) gives concrete dated occurrences. The
 *    website agenda and the reminder ladder both need real dates.
 *  - "masters" (singleEvents=false) keeps RRULE intact. CLAUDE.md section 10:
 *    copy the recurrence rule into the .ics, never expand it, or a weekly
 *    service becomes 200 VEVENTs that no phone will thank us for.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { googleRequest } from './google.ts';
import type { Config, Ministry, RawEvent } from './types.ts';
import { JOB_DIR, calendarIdFor, USE_FIXTURES } from './config.ts';

const API = 'https://www.googleapis.com/calendar/v3';

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  return googleRequest(API + path + '?' + new URLSearchParams(params), { label: 'Calendar' });
}

async function listEvents(
  calendarId: string,
  params: Record<string, string>,
): Promise<any[]> {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const page = await apiGet(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      maxResults: '2500',
      ...params,
      ...(pageToken ? { pageToken } : {}),
    });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export type MinistryFetch = {
  ministry: Ministry;
  instances: RawEvent[];
  masters: RawEvent[];
  error: string | null;
};

function tag(ministryId: string, items: any[]): RawEvent[] {
  return items.map((it) => ({ ...it, ministry: ministryId })) as RawEvent[];
}

function usable(ev: any): boolean {
  // Cancelled standalone events carry no start and are simply gone.
  if (ev.status === 'cancelled' && !ev.recurringEventId) return false;
  return Boolean(ev.start || ev.originalStartTime);
}

/** Read every enabled ministry calendar. One bad calendar does not stop the rest. */
export async function fetchAll(
  cfg: Config,
  ministries: Ministry[],
  timeMin: Date,
  timeMax: Date,
): Promise<MinistryFetch[]> {
  if (USE_FIXTURES()) return fetchFixtures(ministries);

  const out: MinistryFetch[] = [];
  for (const m of ministries) {
    const calendarId = calendarIdFor(m);
    if (!calendarId) {
      out.push({
        ministry: m,
        instances: [],
        masters: [],
        error: `No calendar configured (set ${m.calendarIdEnv})`,
      });
      continue;
    }
    try {
      const common = {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: cfg.timezone,
      };
      const [instances, masters] = await Promise.all([
        listEvents(calendarId, { ...common, singleEvents: 'true', orderBy: 'startTime' }),
        listEvents(calendarId, { ...common, singleEvents: 'false', showDeleted: 'true' }),
      ]);
      out.push({
        ministry: m,
        instances: tag(m.id, instances.filter(usable)),
        masters: tag(m.id, masters.filter(usable)),
        error: null,
      });
    } catch (err) {
      out.push({ ministry: m, instances: [], masters: [], error: (err as Error).message });
    }
  }
  return out;
}

/**
 * Offline mode. Runs the whole pipeline with no credentials, against titles
 * written the way the church's leaders actually write them.
 */
function fetchFixtures(ministries: Ministry[]): MinistryFetch[] {
  const path = join(JOB_DIR, 'fixtures', 'calendars.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any[]>;
  return ministries.map((m) => {
    const items = (data[m.id] ?? []).filter(usable);
    return {
      ministry: m,
      instances: tag(m.id, items),
      masters: tag(m.id, items),
      error: null,
    };
  });
}
