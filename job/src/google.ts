/**
 * Shared Google API access: one service-account client, one retrying request
 * helper. Both the Calendar and Sheets code go through here.
 */

import { JWT } from 'google-auth-library';

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
      key: creds.private_key.replace(/\\n/g, '\n'),
      scopes: SCOPES,
    });
    await jwt.authorize();
    return jwt;
  })();
  return clientPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ApiOptions = {
  method?: string;
  body?: unknown;
  /** Label used in error messages, e.g. "Calendar" or "Sheets". */
  label?: string;
};

/**
 * One Google REST call, retrying only what is worth retrying.
 *
 * A 403 here is almost always "the service account was never shared onto this
 * calendar or sheet", which no amount of retrying fixes, so it fails straight
 * away with a message that says so rather than after four slow attempts.
 */
export async function googleRequest(url: string, opts: ApiOptions = {}): Promise<any> {
  const client = await googleClient();
  const label = opts.label ?? 'Google';
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** attempt);
    const token = await client.getAccessToken();
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token.token}`,
        accept: 'application/json',
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.ok) return res.json();

    const text = await res.text();
    lastErr = new Error(`${label} API ${res.status}: ${text.slice(0, 400)}`);
    if (res.status === 404 || res.status === 401) throw lastErr;
    if (res.status === 403 && !/rateLimit|userRateLimit|quota/i.test(text)) throw lastErr;
  }
  throw lastErr ?? new Error(`${label} API failed: ${url}`);
}
