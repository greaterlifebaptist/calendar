/**
 * Job entry point (phase 1, step 1): fetch -> classify -> publish.
 *
 * Run it with no credentials at all:   npm run dev
 * Run it against the real calendars:   npm start
 */

import {
  loadConfig, loadDotEnv, activeMinistries, pendingMinistries,
  USE_FIXTURES, ROOT, outputDir, DRY_RUN,
} from './config.ts';
import { fetchAll } from './fetch.ts';
import { normalizeAll, dedupe, byStart } from './normalize.ts';
import { publish } from './publish.ts';
import { writeBackup } from './backup.ts';
import { readPeople, duplicateTokens } from './sheet.ts';
import { writePersonalFeeds } from './personal.ts';
import { writeComboFeeds } from './combo.ts';
import {
  planReminders, planDigest, sendReminders,
  loadState, saveState, pruneState, statePath, nextReminders,
} from './remind.ts';
import { addMonths, startOfMonth } from './time.ts';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CalEvent, Config, Ministry } from './types.ts';

/** How far ahead to read. Deep enough for next summer's trip to be pinned. */
const HORIZON_MONTHS = 18;

/**
 * Everything the run said, kept so it can be repeated into the Actions run
 * summary at the end.
 *
 * A step's output on the run page is collapsed behind a disclosure triangle,
 * and the lines saying whether personal feeds were built are exactly what
 * somebody needs when a subscription will not add. Nobody thinks to expand a
 * step that reported success, so the summary shows the whole run without a
 * click.
 */
const transcript: string[] = [];

function log(msg: string): void {
  transcript.push(msg);
  process.stdout.write(msg + '\n');
}

/** Repeat the run into the Actions summary. Never allowed to fail the run. */
function writeRunSummary(ok: boolean): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file,
      '## Calendar sync' + (ok ? '' : ' — FAILED') + '\n\n' +
      '```\n' + transcript.join('\n').trim() + '\n```\n');
  } catch (err) {
    process.stdout.write('  [warn] could not write the run summary: ' + err + '\n');
  }
}

/**
 * Build the per-person feeds, or explain why not.
 *
 * A missing sheet is not a failure: everything else in the run is still valid
 * and the church may simply not have set membership up yet.
 */
async function publishPersonalFeeds(cfg: Config, masters: CalEvent[]) {
  if (USE_FIXTURES()) return null;
  if (!process.env.SHEET_ID?.trim()) {
    // Skipping is fine before membership is set up. It stops being fine the
    // moment the signup page is live, because from then on the page hands out
    // feed URLs that resolve to a 404 page. Apple Calendar reports that as
    // "validation failed", which reads as a bad link rather than as a missing
    // secret, so it has to be loud where somebody will see it.
    if (cfg.site.signupEndpoint) {
      log('::error::Signup is switched on but SHEET_ID is not set, so no personal ' +
        'feeds are being built. Everyone who signs up gets a link that 404s.');
    } else {
      log('  personal     skipped, no SHEET_ID configured');
    }
    return null;
  }
  const sheet = await readPeople(cfg);
  for (const col of sheet.unknownColumns) {
    log('  [warn] People tab column "' + col + '" matches no ministry id, ignored');
  }
  const dupes = duplicateTokens(sheet.people);
  if (dupes.length) {
    throw new Error('Duplicate tokens in the People tab: ' + dupes.join(', ') +
      '. Two people would share one feed.');
  }
  if (!sheet.people.length) {
    // Not an error on day one, but if it ever happens after people have signed
    // up, every subscription stops resolving, so it must be loud.
    log('  [warn] the People tab has no rows with a token, so no personal feeds exist');
  }
  return writePersonalFeeds(cfg, sheet.people, masters, outputDir());
}


/** Say when the next reminders land, so a quiet run is not a mystery. */
function reportUpcoming(
  cfg: Config, ministries: Ministry[], instances: CalEvent[], masters: CalEvent[],
  state: Parameters<typeof nextReminders>[0]['state'], now: Date,
): void {
  const upcoming = nextReminders({ cfg, ministries, instances, masters, state, now });
  if (!upcoming.length) {
    const withChannel = ministries.filter((m) => (m.notify ?? []).length);
    log(withChannel.length
      ? '  nothing due in the next 60 days either'
      : '  no ministry has a GroupMe channel, so nothing will ever be sent');
    return;
  }
  log('  next up:');
  for (const u of upcoming) {
    log('    ' + u.when.toISOString().slice(0, 10) + '  ' +
      u.reminder.title + '  (' + u.reminder.ruleId + ', ' + u.reminder.ministry + ')');
  }
}
/**
 * Work out what the ladder owes, and send it unless anything says not to.
 *
 * Returns a message when the run should be treated as failed, so a reminder
 * problem goes red and opens an issue rather than passing quietly.
 */
async function runReminders(
  cfg: Config,
  ministries: Ministry[],
  instances: CalEvent[],
  masters: CalEvent[],
  now: Date,
): Promise<string | null> {
  const path = statePath(ROOT);
  const state = loadState(path);
  const plan = planReminders({ cfg, ministries, instances, masters, state, now });
  const digest = plan.skipped ? [] : planDigest({ cfg, ministries, instances, masters, state, now });
  const all = [...plan.due, ...digest];

  log('');
  log('Reminders');

  // Seeding happens on the first run of any kind, including a quiet one, so
  // the state file exists long before anybody tries a real send.
  //
  // It used to wait for the first run that had something to send, which meant
  // the very first deliberate test was silently swallowed AND its rung marked
  // as handled, so it would never fire at all. The backlog it guards against
  // is still guarded: the blast limit below refuses any run wanting more than
  // a handful, whenever that happens.
  if (plan.seeding) {
    const seeded: Record<string, string> = {};
    for (const r of all) seeded[r.key] = now.toISOString();
    saveState(path, { sent: seeded, seededAt: now.toISOString() });
    log(all.length
      ? '  first run: recorded ' + all.length + ' reminder(s) as already handled and sent none.'
      : '  first run: nothing was due, so nothing was suppressed.');
    log('  from now on reminders behave normally.');
    reportUpcoming(cfg, ministries, instances, masters, { sent: seeded }, now);
    return null;
  }

  if (plan.skipped && !all.length) {
    log('  ' + plan.skipped);
    reportUpcoming(cfg, ministries, instances, masters, state, now);
    return null;
  }

  if (!all.length) {
    log('  nothing due right now');
    reportUpcoming(cfg, ministries, instances, masters, state, now);
    return null;
  }

  // A run wanting a pile of messages is a bug until proven otherwise.
  if (all.length > cfg.reminderSchedule.maxPerRun) {
    log('  [FAIL] ' + all.length + ' reminders wanted, limit is ' +
      cfg.reminderSchedule.maxPerRun + '. Sending none.');
    for (const r of all) log('    would have sent: ' + r.title + ' (' + r.ruleId + ')');
    return 'Reminder blast guard tripped: ' + all.length + ' messages wanted in one run.';
  }

  const dryRun = DRY_RUN();
  log('  ' + all.length + ' due' + (dryRun ? ', DRY RUN so nothing will be sent' : ''));

  const live: import('./remind.ts').ReminderState = state ?? { sent: {} };
  const outcome = await sendReminders(cfg, all, live, { dryRun, now, log });

  if (!dryRun) saveState(path, pruneState(live, now));

  log('  sent ' + outcome.sent + ', failed ' + outcome.failed.length);
  for (const f of outcome.failed) log('    [FAIL] ' + f);
  return outcome.failed.length ? 'Reminder delivery failed: ' + outcome.failed.join('; ') : null;
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

  // Every combination of public ministries, built ahead of anyone asking, so
  // signing up hands over a URL that already exists instead of one that 404s
  // until the next deploy.
  const combo = writeComboFeeds(cfg, masters, outputDir());
  log('  combos       ' + combo.written + ' feeds, ' +
    Math.round(combo.bytes / 1024) + ' KB' +
    (combo.removed ? ', ' + combo.removed + ' retired' : ''));

  // Personal feeds last: they are the only place private ministries appear,
  // and they are rebuilt from the sheet every run so a removed row or a
  // cleared column takes effect on the next refresh.
  const personal = await publishPersonalFeeds(cfg, masters);
  if (personal) {
    log('  personal     ' + personal.written + ' feeds (' + personal.empty +
      ' with nothing selected, ' + personal.removed + ' revoked)');
  }
  log('  backup       ' + backup.events + ' raw events from ' + backup.calendars + ' calendars');

  // ---- reminders ----
  // Last, and behind every guard in remind.ts. Everything above this point
  // is recoverable by re-running; a wrong message to thirty parents is not.
  const reminderProblem = await runReminders(cfg, ministries, cleanInstances, masters, now);
  if (reminderProblem) problems.push(reminderProblem);

  const hardFailures = results.filter((r) => r.error);
  if (hardFailures.length || reminderProblem) {
    log('');
    log('FAILED:');
    for (const p of problems) log('  - ' + p);
    return 1;
  }
  return 0;
}

run()
  .then((code) => { writeRunSummary(code === 0); process.exit(code); })
  .catch((err) => {
    console.error(err);
    log(String(err && err.stack ? err.stack : err));
    writeRunSummary(false);
    process.exit(1);
  });
