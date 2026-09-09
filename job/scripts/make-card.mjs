/**
 * Build the printed calendar card.
 *
 *   npm run card                    the two months ahead
 *   CARD_MONTH=2027-01 npm run card  a specific first month
 *
 * Run by hand, from the "Make the calendar card" workflow. Deliberately not
 * part of the hourly sync: a card goes to a printer on the church's schedule,
 * and an hourly rebuild would quietly replace a file after it had already been
 * sent, so the copy on the site would stop matching what was printed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCard } from '../src/card.ts';
import { loadConfig, loadDotEnv, activeMinistries, ROOT } from '../src/config.ts';
import { fetchAll } from '../src/fetch.ts';
import { normalizeAll } from '../src/normalize.ts';
import { readSettings } from '../src/sheet.ts';
import { addMonths, startOfMonth } from '../src/time.ts';

loadDotEnv();

const cfg = loadConfig();
const ministries = activeMinistries(cfg);

/**
 * When to pretend it is, so the card covers the months asked for.
 *
 * cardMonths() always takes the two months AFTER the run, so asking for
 * January means running as though it were December.
 */
function asOf() {
  const want = (process.env.CARD_MONTH ?? '').trim();
  if (!want) return new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(want);
  if (!m) {
    console.error('CARD_MONTH should look like 2027-01, not "' + want + '".');
    process.exit(1);
  }
  const first = new Date(Number(m[1]), Number(m[2]) - 1, 15, 12);
  return addMonths(first, -1, cfg.timezone);
}

const now = asOf();

// Read far enough ahead to cover both months, whatever they are.
const from = startOfMonth(now, cfg.timezone);
const to = addMonths(from, 4, cfg.timezone);

const results = await fetchAll(cfg, ministries, from, to);
const failed = results.filter((r) => r.error);
if (failed.length) {
  // A card missing a ministry is worse than no card: it would be printed,
  // handed out, and nobody would know what was left off.
  console.error('Could not read every calendar, so no card was made:');
  for (const r of failed) console.error('  ' + r.ministry.id + ': ' + r.error);
  process.exit(1);
}

const events = results.flatMap((r) => normalizeAll(r.instances, cfg.timezone, now));

const settings = await readSettings();
const asset = (name) => {
  const p = join(ROOT, 'job', 'assets', name);
  return existsSync(p) ? readFileSync(p) : undefined;
};
const qrPath = join(ROOT, 'site', 'qr-calendar.pdf');

const out = await buildCard({
  cfg,
  ministries,
  events,
  now,
  outDir: join(ROOT, 'public', 'card'),
  logo: asset('logo-wide.jpg'),
  qrPdf: existsSync(qrPath) ? readFileSync(qrPath) : undefined,
  standingNotes: settings.cardNotes,
});

console.log('Calendar card');
console.log('  months   ' + out.months.join(' and '));
console.log('  events   ' + out.events);
console.log('  notes    ' + (settings.cardNotes ? 'from the admin page' : 'from config'));
console.log('  file     ' + out.path.replace(ROOT, '').replace(/\\/g, '/'));

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const name = out.path.split(/[\\/]/).pop();
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summary,
    '## Calendar card\n\n' +
    '**' + out.months.join(' and ') + '** — ' + out.events + ' events.\n\n' +
    'Once the site redeploys, download it here and send it to the printer:\n\n' +
    'https://calendars.greaterlifebaptistchurch.com/card/' + name + '\n');
}
