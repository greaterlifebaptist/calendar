/**
 * Restore a calendar from a backup snapshot.
 *
 * Usage:
 *   cd job && npm run restore -- --list
 *   cd job && npm run restore -- --ministry youth
 *   cd job && npm run restore -- --ministry youth --confirm
 *   cd job && npm run restore -- --ministry youth --into <calendarId> --confirm
 *
 * Defaults to a dry run. Nothing is written to Google without --confirm.
 *
 * This adds events that are missing from the target calendar. It never deletes
 * and never edits, so running it twice is safe and running it against a
 * partially recovered calendar fills the gaps rather than duplicating them.
 * Matching is on iCalUID, which Google preserves across a restore.
 *
 * Restoring into a NEW calendar is usually the right move after a bad
 * deletion: recover to a fresh calendar, check it, then repoint calendarId in
 * job/config/ministries.json. That way the damaged calendar is still there if
 * the restore turns out to be wrong.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';

// scripts/ lives inside job/, so the repo root is two levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://www.googleapis.com/calendar/v3';

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const BACKUP_DIR = String(arg('backup', join(ROOT, 'backup')));
const CONFIRM = arg('confirm', false) === true;
const LIST = arg('list', false) === true;
const MINISTRY = arg('ministry');
const INTO = arg('into');

function die(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

function loadEnv() {
  for (const p of [join(ROOT, '.env'), join(ROOT, 'job', '.env')]) {
    if (existsSync(p)) {
      try { process.loadEnvFile(p); } catch {}
    }
  }
}

function manifest() {
  const p = join(BACKUP_DIR, 'manifest.json');
  if (!existsSync(p)) {
    die(
      'No backup found at ' + BACKUP_DIR + '\n' +
      'Clone the backup repository and pass --backup <path>, or run the job\n' +
      'once locally to produce a fresh snapshot.',
    );
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function client() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) die('Missing GOOGLE_SERVICE_ACCOUNT_JSON. Put it in .env for this run.');
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const creds = JSON.parse(text);
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  await jwt.authorize();
  return jwt;
}

async function api(jwt, method, path, body) {
  const token = await jwt.getAccessToken();
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token.token,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function existingUids(jwt, calendarId) {
  const uids = new Set();
  let pageToken;
  do {
    const params = new URLSearchParams({
      maxResults: '2500',
      singleEvents: 'false',
      showDeleted: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await api(jwt, 'GET', '/calendars/' + encodeURIComponent(calendarId) + '/events?' + params);
    for (const e of page.items ?? []) if (e.iCalUID) uids.add(e.iCalUID);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return uids;
}

/** Strip the read-only fields Google rejects on write. */
function forInsert(ev) {
  const {
    etag, htmlLink, created, updated, creator, organizer, hangoutLink,
    conferenceData, iCalUID, id, kind, eventType, recurringEventId,
    originalStartTime, sequence, attendees, reminders, ...rest
  } = ev;
  return { ...rest, iCalUID, ...(sequence !== undefined ? { sequence } : {}) };
}

async function main() {
  loadEnv();
  const m = manifest();

  if (LIST || !MINISTRY) {
    console.log('\nBackup captured ' + m.capturedAt);
    console.log('  ' + m.calendars + ' calendars, ' + m.events + ' events\n');
    for (const i of m.index) {
      console.log('  ' + i.ministry.padEnd(16) + String(i.count).padStart(5) + '  ' + i.visibility);
    }
    console.log('\nRestore one with:  npm run restore -- --ministry <id>\n');
    return;
  }

  const entry = m.index.find((i) => i.ministry === MINISTRY);
  if (!entry) die('No snapshot for ministry "' + MINISTRY + '". Use --list to see what is available.');

  const snap = JSON.parse(readFileSync(join(BACKUP_DIR, entry.file), 'utf8'));
  const target = typeof INTO === 'string' ? INTO : snap.calendarId;
  if (!target) die('No target calendar. Pass --into <calendarId>.');

  // A cancelled occurrence is an absence, not an event. Restoring it would
  // resurrect a meeting somebody deliberately called off.
  const restorable = snap.items.filter((e) => e.status !== 'cancelled' && !e.recurringEventId);
  const skippedOverrides = snap.items.filter((e) => e.recurringEventId && e.status !== 'cancelled').length;

  console.log('\nRestore ' + MINISTRY + ' (' + snap.name + ')');
  console.log('  from    ' + entry.file + ', captured ' + snap.capturedAt);
  console.log('  into    ' + target);
  console.log('  mode    ' + (CONFIRM ? 'WRITING' : 'dry run, nothing will be written'));

  const jwt = await client();
  const already = await existingUids(jwt, target);
  const missing = restorable.filter((e) => !e.iCalUID || !already.has(e.iCalUID));

  console.log('\n  in snapshot        ' + snap.items.length);
  console.log('  already present    ' + (restorable.length - missing.length));
  console.log('  to restore         ' + missing.length);
  if (skippedOverrides) {
    console.log('  single occurrences skipped: ' + skippedOverrides +
      ' (they follow their series and cannot be inserted alone)');
  }

  if (!missing.length) {
    console.log('\nNothing to do.\n');
    return;
  }

  for (const e of missing) console.log('    + ' + (e.summary ?? '(no title)'));

  if (!CONFIRM) {
    console.log('\nDry run. Re-run with --confirm to write these to Google.\n');
    return;
  }

  let ok = 0;
  const failed = [];
  for (const e of missing) {
    try {
      await api(jwt, 'POST', '/calendars/' + encodeURIComponent(target) + '/events?supportsAttachments=false', forInsert(e));
      ok++;
    } catch (err) {
      failed.push((e.summary ?? e.id) + ': ' + err.message);
    }
  }

  console.log('\n  restored ' + ok + ' of ' + missing.length);
  for (const f of failed) console.log('  FAILED ' + f);
  console.log('');
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
