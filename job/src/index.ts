/**
 * Job entry point (phase 1, step 1): fetch -> classify -> publish.
 *
 * Run it with no credentials at all:   npm run dev
 * Run it against the real calendars:   npm start
 */

import { loadConfig, loadDotEnv, activeMinistries, pendingMinistries, USE_FIXTURES, ROOT } from './config.ts';
import { fetchAll } from './fetch.ts';
import { normalizeAll, dedupe, byStart } from './normalize.ts';
import { publish } from './publish.ts';
import { writeBackup } from './backup.ts';
import { addMonths, startOfMonth } from './time.ts';
import { join } from 'node:path';
import type { CalEvent } from './types.ts';

/** How far ahead to read. Deep enough for next summer's trip to be pinned. */
const HORIZON_MONTHS = 18;

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

export async function run(): Promise<number> {
  loadDotEnv();
  const cfg = loadConfig();
  const tz = cfg.timezone;
  const now = new Date();

  const ministries = activeMinistries(cfg);
  const pending = pendingMinistries(cfg);
  if (!ministries.length) {
    log('No ministry has a calendar id. Add one in job/config/ministries.json.');
    return 1;
  }

  // The site shows the current month onward, so start at the month boundary.
  const timeMin = startOfMonth(now, tz);
  const timeMax = addMonths(now, HORIZON_MONTHS, tz);

  log('GLBC calendar sync');
  log('  mode      ' + (USE_FIXTURES() ? 'FIXTURES (no Google API calls)' : 'live'));
  log('  window    ' + timeMin.toISOString().slice(0, 10) + ' -> ' + timeMax.toISOString().slice(0, 10));
  log('  ministries ' + ministries.map((m) => m.id).join(', '));
  if (pending.length) {
    log('  waiting   ' + pending.map((m) => m.id).join(', ') + ' (no calendar id yet)');
  }

  const results = await fetchAll(cfg, ministries, timeMin, timeMax);

  const problems: string[] = [];
  const instances: CalEvent[] = [];
  const masters: CalEvent[] = [];

  for (const r of results) {
    if (r.error) {
      problems.push(r.ministry.id + ': ' + r.error);
      log('  [FAIL] ' + r.ministry.id + ' — ' + r.error);
      continue;
    }
    instances.push(...normalizeAll(r.instances, tz, now));
    masters.push(...normalizeAll(r.masters, tz, now));
    log('  [ ok ] ' + r.ministry.id + ' — ' + r.instances.length + ' occurrences, ' + r.masters.length + ' raw');
  }

  // Snapshot before publishing. If publishing throws, the backup still ran.
  const backup = writeBackup(cfg, results, join(ROOT, 'backup'), now);

  const cleanInstances = dedupe(instances).sort(byStart);
  const result = publish({ cfg, ministries, instances: cleanInstances, masters, generated: now });

  const counts = new Map<string, number>();
  for (const e of cleanInstances) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const pinned = cleanInstances.filter((e) => e.pinned).length;

  log('');
  log('Published');
  log('  events.json  ' + result.publicEventCount + ' public events (' + result.privateEventCount + ' private withheld)');
  log('  by type      ' + [...counts].map(([k, v]) => k + '=' + v).join(' ') + '  pinned=' + pinned);
  log('  feeds        ' + result.feedPaths.length + ' .ics files');
  log('  backup       ' + backup.events + ' raw events from ' + backup.calendars + ' calendars');

  const hardFailures = results.filter((r) => r.error);
  if (hardFailures.length) {
    log('');
    log('FAILED for ' + hardFailures.length + ' calendar(s):');
    for (const p of problems) log('  - ' + p);
    return 1;
  }
  return 0;
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
