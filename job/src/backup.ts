/**
 * Raw calendar snapshots.
 *
 * The realistic way this church loses calendar data is not a Google disk
 * failure. It is a leader deleting a recurring series, somebody removing a
 * calendar, or the account itself being lost. Google keeps deleted *events* in
 * a per-calendar trash for thirty days, but a deleted secondary calendar is
 * generally gone, and none of that helps if the account does.
 *
 * So: every run writes an exact copy of what the API returned, per calendar,
 * unclassified and unfiltered. The published feeds are derived data and are a
 * poor thing to restore from. These snapshots are not.
 *
 * They include private ministries, so they must never be written anywhere
 * public. The workflow pushes them to a separate private repository.
 *
 * The per-calendar files deliberately carry NO timestamp. They used to, and it
 * meant every file differed on every run, so the backup repository took a
 * commit an hour forever — 8,760 snapshots a year, almost all of them
 * recording nothing but the clock. The history is the whole point of a backup;
 * being able to find the week somebody deleted a recurring series matters more
 * than knowing which hour a byte-identical copy was taken. So a calendar file
 * changes only when the calendar did, and the capture time lives once, in the
 * manifest.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MinistryFetch } from './fetch.ts';
import type { Config } from './types.ts';

export type BackupResult = {
  dir: string;
  files: string[];
  calendars: number;
  events: number;
};

/**
 * `masters` is the unexpanded read: recurrence rules intact, exceptions and
 * cancellations included. It is the smaller and more faithful of the two
 * reads, and the one a restore should replay.
 */
export function writeBackup(
  cfg: Config,
  results: MinistryFetch[],
  dir: string,
  now: Date = new Date(),
): BackupResult {
  // Rebuild the directory each run so a ministry that is removed from config
  // does not leave a stale snapshot behind pretending to be current.
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'calendars'), { recursive: true });

  const files: string[] = [];
  let events = 0;
  const index: Record<string, unknown>[] = [];

  for (const r of results) {
    if (r.error) continue;
    const items = r.masters;
    events += items.length;

    const path = join(dir, 'calendars', r.ministry.id + '.json');
    writeFileSync(
      path,
      JSON.stringify(
        {
          ministry: r.ministry.id,
          name: r.ministry.name,
          visibility: r.ministry.visibility,
          calendarId: r.ministry.calendarId,
          timeZone: cfg.timezone,
          count: items.length,
          // Verbatim API resources. Do not normalise; a restore needs these
          // exactly as Google gave them.
          items,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    files.push(path);
    index.push({
      ministry: r.ministry.id,
      visibility: r.ministry.visibility,
      count: items.length,
      file: 'calendars/' + r.ministry.id + '.json',
    });
  }

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        capturedAt: now.toISOString(),
        timezone: cfg.timezone,
        calendars: index.length,
        events,
        note: 'Verbatim Google Calendar API event resources. Restore with scripts/restore.mjs.',
        index,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  return { dir, files, calendars: index.length, events };
}
