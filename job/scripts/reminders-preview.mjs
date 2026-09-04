/**
 * Show every reminder the ladder would send over the coming weeks, without
 * sending anything and without touching the saved state.
 *
 * This exists so the wording and the timing can be read and argued with before
 * a single message reaches a parent. Point it at the real calendars or at the
 * fixtures; either way it only reads.
 *
 *   cd job && npm run preview:reminders
 *   cd job && npm run preview:reminders -- --fixtures
 *   cd job && npm run preview:reminders -- --days 60
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const p of [join(ROOT, '.env'), join(ROOT, 'job', '.env')]) {
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch {}
  }
}

const { loadConfig, activeMinistries } = await import('../src/config.ts');
const { fetchAll } = await import('../src/fetch.ts');
const { normalizeAll, dedupe, byStart } = await import('../src/normalize.ts');
const { planReminders, planDigest } = await import('../src/remind.ts');
const { addMonths, startOfMonth, zonedParts } = await import('../src/time.ts');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const DAYS = Number(arg('days', 45));
const cfg = loadConfig();
const tz = cfg.timezone;
const ministries = activeMinistries(cfg);
const now = new Date();

const results = await fetchAll(cfg, ministries, startOfMonth(now, tz), addMonths(now, 18, tz));
for (const r of results) {
  if (r.error) console.error('  [skip] ' + r.ministry.id + ': ' + r.error);
}

const instances = dedupe(results.flatMap((r) => normalizeAll(r.instances, tz, now))).sort(byStart);
const masters = results.flatMap((r) => normalizeAll(r.masters, tz, now));

/** Walk forward a day at a time, at the configured send hour. */
function atSendHour(base, dayOffset, hour) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  const p = zonedParts(d, tz);
  // Build the local wall clock, then let the Date carry the right instant.
  return new Date(new Date(`${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00`).getTime());
}

console.log('');
console.log('What the reminder ladder would send over the next ' + DAYS + ' days');
console.log('  ministries with a channel: ' +
  (ministries.filter((m) => (m.notify || []).length).map((m) => m.id).join(', ') || 'none'));
console.log('  send hour: ' + cfg.reminderSchedule.sendHour + ':00 ' + tz);
console.log('  nothing below is sent, and the saved state is not touched.');
console.log('');

let total = 0;
const state = { sent: {} };

for (let day = 0; day <= DAYS; day++) {
  const when = atSendHour(now, day, cfg.reminderSchedule.sendHour);
  const plan = planReminders({ cfg, ministries, instances, masters, state, now: when });
  const digestWhen = atSendHour(now, day, cfg.reminderSchedule.digest.hour);
  const digest = planDigest({ cfg, ministries, instances, masters, state, now: digestWhen });
  const all = [...plan.due, ...digest];
  if (!all.length) continue;

  const p = zonedParts(when, tz);
  const label = new Date(Date.UTC(p.y, p.m - 1, p.d))
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  console.log('─'.repeat(64));
  console.log(label + (day === 0 ? '  (today)' : ''));
  console.log('');
  for (const r of all) {
    total++;
    // Mark as sent so the same rung is not counted again tomorrow.
    state.sent[r.key] = when.toISOString();
    console.log('  to ' + (cfg.channels[r.channelId]?.label ?? r.channelId) +
      '   [' + r.ministry + ' · ' + r.ruleId + ']');
    for (const line of r.text.split('\n')) console.log('    ' + line);
    console.log('');
  }
}

console.log('─'.repeat(64));
console.log(total + ' message(s) over ' + DAYS + ' days.');
if (!total) {
  console.log('Nothing is due. Either no ministry has a channel configured, or');
  console.log('there is nothing on those calendars within reach of the ladder.');
}
console.log('');
