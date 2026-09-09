/**
 * Build the printed calendar card, and email it to whoever is set to receive it.
 *
 *   npm run card                     the two months ahead
 *   CARD_MONTH=2027-01 npm run card  a specific first month
 *
 * Run by hand, from the "Make the calendar card" workflow. Deliberately not
 * part of the hourly sync: a card goes to a printer on the church's schedule,
 * and an hourly rebuild would quietly replace a file after it had already been
 * sent, so the copy on the site would stop matching what was printed.
 *
 * Anything that goes wrong is emailed too. Silence is the worst outcome here —
 * somebody would be waiting on a card that was never coming and would find out
 * when the printer asked.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCard } from '../src/card.ts';
import { loadConfig, loadDotEnv, activeMinistries, ROOT } from '../src/config.ts';
import { fetchAll } from '../src/fetch.ts';
import { normalizeAll } from '../src/normalize.ts';
import { readSettings } from '../src/sheet.ts';
import { addMonths, startOfMonth } from '../src/time.ts';

loadDotEnv();

const cfg = loadConfig();

/** Tell whoever is waiting. Never allowed to be the reason the run fails. */
async function tell(contact, fields) {
  const endpoint = cfg.site.signupEndpoint;
  const passcode = process.env.ADMIN_PASSCODE?.trim();
  if (!endpoint || !passcode || !contact) {
    console.log('  email    skipped (' +
      (!contact ? 'nobody set to receive it' : 'no endpoint or passcode') + ')');
    return;
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'card.mail', passcode, contact, ...fields }),
      signal: AbortSignal.timeout(60000),
    });
    const out = await res.json();
    console.log(out.ok
      ? '  email    sent to ' + contact
      : '  [warn] could not email ' + contact + ': ' + out.error);
  } catch (err) {
    console.log('  [warn] could not email ' + contact + ': ' +
      (err instanceof Error ? err.message : String(err)));
  }
}

function asOf() {
  const want = (process.env.CARD_MONTH ?? '').trim();
  if (!want) return new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(want);
  if (!m) {
    console.error('CARD_MONTH should look like 2027-01, not "' + want + '".');
    process.exit(1);
  }
  // cardMonths() always takes the two months AFTER the run, so asking for
  // January means running as though it were December.
  return addMonths(new Date(Number(m[1]), Number(m[2]) - 1, 15, 12), -1, cfg.timezone);
}

const now = asOf();
const settings = await readSettings();
const recipient = (settings.cardEmail ?? '').trim();
const window = [1, 2]
  .map((n) => addMonths(startOfMonth(now, cfg.timezone), n, cfg.timezone))
  .map((d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric' }))
  .join(' and ');

try {
  const ministries = activeMinistries(cfg);
  const from = startOfMonth(now, cfg.timezone);
  const results = await fetchAll(cfg, ministries, from, addMonths(from, 4, cfg.timezone));

  const failed = results.filter((r) => r.error);
  if (failed.length) {
    // A card missing a ministry is worse than no card: it would be printed,
    // handed out, and nobody would know what had been left off.
    throw new Error('Could not read every calendar:\n' +
      failed.map((r) => '  ' + r.ministry.id + ': ' + r.error).join('\n'));
  }

  const events = results.flatMap((r) => normalizeAll(r.instances, cfg.timezone, now));
  const asset = (name) => {
    const p = join(ROOT, 'job', 'assets', name);
    return existsSync(p) ? readFileSync(p) : undefined;
  };
  const qrPath = join(ROOT, 'site', 'qr-calendar.pdf');

  const out = await buildCard({
    cfg, ministries, events, now,
    outDir: join(ROOT, 'public', 'card'),
    logo: asset('logo-wide.jpg'),
    qrPdf: existsSync(qrPath) ? readFileSync(qrPath) : undefined,
    standingNotes: settings.cardNotes,
  });

  const file = out.path.split(/[\\/]/).pop();
  console.log('Calendar card');
  console.log('  months   ' + out.months.join(' and '));
  console.log('  events   ' + out.events);
  console.log('  notes    ' + (settings.cardNotes ? 'from the admin page' : 'from config'));
  console.log('  file     public/card/' + file);

  await tell(recipient, {
    months: out.months.join(' and '),
    filename: file,
    pdf: readFileSync(out.path).toString('base64'),
  });

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Calendar card\n\n' +
      '**' + out.months.join(' and ') + '** — ' + out.events + ' events' +
      (recipient ? ', emailed to ' + recipient : '') + '.\n\n' +
      'Once the site redeploys, download it here and send it to the printer:\n\n' +
      'https://calendars.greaterlifebaptistchurch.com/card/' + file + '\n');
  }
} catch (err) {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('The card could not be made.\n' + message);
  await tell(recipient, { months: window, error: message });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Calendar card — FAILED\n\n```\n' + message + '\n```\n' +
      (recipient ? '\n' + recipient + ' has been told.\n' : ''));
  }
  process.exit(1);
}
