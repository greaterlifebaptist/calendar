/**
 * Add or list people in the membership sheet, from the command line.
 *
 * The signup page will do this for public groups. This exists for the case the
 * signup page must never handle: putting somebody into a *private* group, which
 * only a leader may do. It is also how you test personal feeds before either
 * page exists.
 *
 *   cd job && npm run person -- --list
 *   cd job && npm run person -- --add "Jane Doe" --groups church,youth
 *   cd job && npm run person -- --add "Bro. Spencer" --email s@x.com --groups church,youth,youth-leaders
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

const { loadConfig } = await import('../src/config.ts');
const { readPeople, addPerson, feedUrl } = await import('../src/sheet.ts');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return null;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const cfg = loadConfig();
const byId = new Map(cfg.ministries.map((m) => [m.id, m]));

function die(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

const name = arg('add');
const list = arg('list') === true;

if (!name && !list) {
  console.log(`
Usage:
  npm run person -- --list
  npm run person -- --add "Jane Doe" --groups church,youth
  npm run person -- --add "Jane Doe" --email jane@example.com --groups church,youth

Groups available:
${cfg.ministries.map((m) => '  ' + m.id.padEnd(16) + m.name + (m.visibility === 'private' ? '   (private)' : '')).join('\n')}
`);
  process.exit(0);
}

if (list) {
  const sheet = await readPeople(cfg);
  if (sheet.unknownColumns.length) {
    console.log('\nColumns matching no ministry id, ignored: ' + sheet.unknownColumns.join(', '));
  }
  console.log('\n' + sheet.people.length + ' people\n');
  for (const p of sheet.people) {
    console.log('  ' + (p.name || '(no name)').padEnd(22) + (p.groups.join(', ') || '(no groups)'));
    console.log('  ' + ''.padEnd(22) + feedUrl(cfg, p.token));
  }
  console.log('');
  process.exit(0);
}

if (name === true) die('Give a name: --add "Jane Doe"');

const groupsArg = arg('groups');
if (!groupsArg || groupsArg === true) die('Give at least one group: --groups church,youth');

const groups = String(groupsArg).split(',').map((g) => g.trim()).filter(Boolean);
const unknown = groups.filter((g) => !byId.has(g));
if (unknown.length) {
  die('Unknown group(s): ' + unknown.join(', ') +
    '\nAvailable: ' + [...byId.keys()].join(', '));
}

const email = arg('email');
const person = await addPerson(cfg, {
  name: String(name),
  email: typeof email === 'string' ? email : '',
  groups,
});

const privateOnes = groups.filter((g) => byId.get(g).visibility === 'private');

console.log('\nAdded ' + person.name);
console.log('  groups   ' + groups.map((g) => byId.get(g).name).join(', '));
if (privateOnes.length) {
  console.log('  private  ' + privateOnes.join(', ') + '  (a leader added these deliberately)');
}
console.log('  feed     ' + feedUrl(cfg, person.token));
console.log('\nThe feed appears after the next sync run.\n');
