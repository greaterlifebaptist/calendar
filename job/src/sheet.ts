/**
 * The People tab of the membership sheet.
 *
 * Columns are matched by their header name, never by position, so a leader can
 * reorder or insert columns in Google Sheets without breaking the job. Any
 * non-empty value in a ministry column means that person is a member, so the
 * "x" the brief describes works and so does a tick, a date, or a name.
 */

import { randomBytes } from 'node:crypto';
import { googleRequest } from './google.ts';
import type { Config } from './types.ts';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const PEOPLE_TAB = 'People';

/**
 * 128 bits, hex.
 *
 * CLAUDE.md sketches an 8-character token. That is only 32 bits, and the feed
 * URLs sit on a public host, so an attacker is not guessing one person's token,
 * they are sweeping for any valid one. With a few hundred members that is
 * days of scripted requests, not years. This costs nothing and removes the
 * problem: the URL is long, but nobody types it, they scan a QR code.
 */
export function newToken(): string {
  return randomBytes(16).toString('hex');
}

/** Tokens become filenames and URLs, so anything else is rejected outright. */
export function isValidToken(token: string): boolean {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(token);
}

export type Person = {
  name: string;
  email: string;
  token: string;
  created: string;
  /** Ministry ids this person has asked for. */
  groups: string[];
  /** 1-based row in the sheet, for writing back. */
  row: number;
};

export type PeopleSheet = {
  headers: string[];
  people: Person[];
  /** Header names that matched no known ministry, reported not guessed at. */
  unknownColumns: string[];
};

function sheetId(): string {
  const id = process.env.SHEET_ID?.trim();
  if (!id) throw new Error('Missing SHEET_ID');
  return id;
}

const norm = (s: string) => s.trim().toLowerCase();

export async function readPeople(cfg: Config): Promise<PeopleSheet> {
  const range = encodeURIComponent(`${PEOPLE_TAB}!A1:ZZ`);
  const data = await googleRequest(`${SHEETS}/${sheetId()}/values/${range}`, { label: 'Sheets' });

  const rows: string[][] = data.values ?? [];
  if (!rows.length) return { headers: [], people: [], unknownColumns: [] };

  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const index = new Map<string, number>();
  headers.forEach((h, i) => index.set(norm(h), i));

  const ministryIds = new Set(cfg.ministries.map((m) => m.id));
  const fixed = new Set(['name', 'email', 'token', 'created', '']);
  const unknownColumns = headers.filter(
    (h) => !fixed.has(norm(h)) && !ministryIds.has(norm(h)),
  );

  const cell = (r: string[], key: string) => {
    const i = index.get(key);
    return i === undefined ? '' : String(r[i] ?? '').trim();
  };

  const people: Person[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const token = cell(r, 'token');
    // A row with no token is not yet a subscriber. Half-typed rows are normal
    // in a shared spreadsheet and must not take the run down.
    if (!token) continue;
    if (!isValidToken(token)) continue;

    const groups: string[] = [];
    for (const m of cfg.ministries) {
      if (cell(r, m.id)) groups.push(m.id);
    }

    people.push({
      name: cell(r, 'name'),
      email: cell(r, 'email'),
      token,
      created: cell(r, 'created'),
      groups,
      row: i + 1,
    });
  }

  return { headers, people, unknownColumns };
}

/** Duplicate tokens would make two people share one feed. Report, never merge. */
export function duplicateTokens(people: Person[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const p of people) {
    if (seen.has(p.token)) dupes.add(p.token);
    seen.add(p.token);
  }
  return [...dupes];
}

export type NewPerson = {
  name: string;
  email?: string;
  groups: string[];
};

/**
 * Append a person, filling each column by its header so the row lands
 * correctly whatever order the sheet is in.
 */
export async function addPerson(
  cfg: Config,
  person: NewPerson,
  now: Date = new Date(),
): Promise<Person> {
  const { headers } = await readPeople(cfg);
  if (!headers.length) throw new Error(`The ${PEOPLE_TAB} tab has no header row.`);

  const token = newToken();
  const wanted = new Set(person.groups);
  const values = headers.map((h) => {
    const key = norm(h);
    if (key === 'name') return person.name;
    if (key === 'email') return person.email ?? '';
    if (key === 'token') return token;
    if (key === 'created') return now.toISOString().slice(0, 10);
    return wanted.has(key) ? 'x' : '';
  });

  const range = encodeURIComponent(`${PEOPLE_TAB}!A1`);
  await googleRequest(
    `${SHEETS}/${sheetId()}/values/${range}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { values: [values] }, label: 'Sheets' },
  );

  return {
    name: person.name,
    email: person.email ?? '',
    token,
    created: now.toISOString().slice(0, 10),
    groups: [...wanted],
    row: -1,
  };
}

/** The personal feed URL for a token. */
export function feedUrl(cfg: Config, token: string): string {
  return cfg.site.personalFeedBase + token + '.ics';
}
