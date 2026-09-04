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
import { JWT } from 'google-auth-library';
import type { Config, Ministry, RawEvent } from './types.ts';
import { JOB_DIR, calendarIdFor, USE_FIXTURES } from './config.ts';

const API = 'https://www.googleapis.com/calendar/v3';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
];

let clientPromise: Promise<JWT> | null = null;

/** Service-account client. Credentials come from Actions secrets, never the repo. */
export function googleClient(): Promise<JWT> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
    let creds: { client_email: string; private_key: string };
    try {
      // Accept both raw JSON and base64, since Actions secrets get pasted both ways.
      const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      creds = JSON.parse(text);
    } catch (err) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(err as Error).message}`);
    }
    const jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key.replace(/\n/g, '\n'),
      scopes: SCOPES,
    });
    await jwt.authorize();
    return jwt;
  })();
  return clientPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const client = await googleClient();
  const url = `${API}${path}?${new URLSearchParams(params)}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** attempt);
    const token = await client.getAccessToken();
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token.token}`, accept: 'application/json' },
    });
    if (res.ok) return res.json();

    const body = await res.text();
    lastErr = new Error(`Calendar API ${res.status} on ${path}: ${body.slice(0, 400)}`);
    // 403 here is usually "calendar not shared with the service account" —
    // retrying will not fix it, so fail fast with a message that says so.
    if (res.status === 404 || res.status === 401) throw lastErr;
    if (res.status === 403 && !/rateLimit|userRateLimit|quota/i.test(body)) throw lastErr;
  }
  throw lastErr ?? new Error(`Calendar API failed: ${path}`);
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
