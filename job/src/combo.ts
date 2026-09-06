/**
 * Pre-built feeds for every combination of public ministries.
 *
 * Why these exist at all: a personal feed cannot be subscribed to until the
 * job has written it and Pages has deployed it, which is a minute or two after
 * somebody signs up. For that minute their own link 404s, and a calendar app
 * given a 404 page says "validation failed", which reads as broken rather than
 * as not-yet. That lands on the very first thing a new person does, standing
 * in the foyer having just scanned a QR code, and it is exactly where adoption
 * is lost.
 *
 * There is nothing to build on demand, though. The public ministries are known
 * in advance, so every combination of them can be built ahead of time. Signing
 * up then hands over a URL that already exists, and the calendar adds
 * instantly.
 *
 * These URLs are deliberately NOT secret, because there is nothing in them to
 * keep: every event in a public ministry is already on the website. Two people
 * who pick the same ministries get the same URL, which is fine and saves
 * building the same file twice.
 *
 * Anyone in a PRIVATE ministry still gets a token feed from personal.ts. That
 * is the one case where the URL is carrying something not otherwise published,
 * so it has to be unguessable and revocable. Those people are added by a
 * leader rather than at a QR code, so the wait does not fall on them the same
 * way.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CalEvent, Config, Ministry } from './types.ts';
import { buildIcs, toIcsInputs } from './ics.ts';

export type ComboResult = {
  written: number;
  removed: number;
  bytes: number;
  dir: string;
  /** Past the point where building every combination still pays for itself. */
  tooBig: boolean;
};

/** Same name every personal feed uses: what people need to recognise is the church. */
const CALENDAR_NAME = 'Greater Life Baptist Church';

/**
 * Refuse to generate an absurd number of files.
 *
 * Subsets double with every ministry. Nine public ministries is 511 files and
 * still trivial; sixteen would be 65535 and would wedge the deploy. If the
 * church ever grows past this, the answer is to build only the combinations
 * actually in use, not to raise the number quietly.
 */
const MAX_PUBLIC = 12;

/**
 * The size at which pre-building stops being the right answer.
 *
 * Subsets are 2^n, and each ministry's events land in half of them, so the
 * total is (2^(n-1)) x the events. That is nothing at seven ministries and a
 * few hundred events; it is tens of megabytes at ten ministries and a full
 * church year, uploaded and deployed every hour for no gain.
 *
 * Crossing this is not an error — the feeds are all still correct — but it is
 * the point at which merging on request is worth the extra moving part, and
 * that decision should be prompted by a number rather than by somebody
 * eventually noticing the deploys got slow.
 */
const NOISY_ABOVE_BYTES = 8 * 1024 * 1024;

/**
 * The URL-safe name for a set of ministries.
 *
 * Sorted, so the order somebody ticked the boxes in cannot produce a second
 * URL for the same calendar. Alphabetical rather than config order, so
 * reordering config/ministries.json cannot silently change everybody's link.
 *
 * The Apps Script builds this same slug when it answers a signup, so the two
 * must agree exactly. Kept trivial for that reason.
 */
export function comboSlug(ids: string[]): string {
  return [...new Set(ids)].sort().join('-');
}

/** Every non-empty subset, smallest first. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const pick: T[] = [];
    for (let i = 0; i < items.length; i++) if (mask & (1 << i)) pick.push(items[i]!);
    out.push(pick);
  }
  return out.sort((a, b) => a.length - b.length);
}

/** The ministries a person may pick for themselves: public, and actually online. */
export function comboMinistries(cfg: Config): Ministry[] {
  return cfg.ministries
    .filter((m) => m.visibility === 'public' && m.calendarId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function writeComboFeeds(
  cfg: Config,
  masters: CalEvent[],
  outRoot: string,
): ComboResult {
  const dir = join(outRoot, 'c');
  mkdirSync(dir, { recursive: true });

  const pool = comboMinistries(cfg);
  if (pool.length > MAX_PUBLIC) {
    throw new Error(
      'Refusing to build ' + (2 ** pool.length - 1) + ' combination feeds for ' +
      pool.length + ' public ministries. See MAX_PUBLIC in combo.ts.',
    );
  }

  const byMinistry = new Map<string, CalEvent[]>();
  for (const m of pool) byMinistry.set(m.id, masters.filter((e) => e.ministry === m.id));

  const wanted = new Set<string>();
  let written = 0;
  let bytes = 0;

  for (const combo of subsets(pool)) {
    const mine = combo.flatMap((m) => byMinistry.get(m.id) ?? []);
    const ics = buildIcs(toIcsInputs(mine, cfg.timezone), cfg, {
      name: CALENDAR_NAME,
      description: 'Greater Life Baptist Church — ' + combo.map((m) => m.name).join(', '),
    });

    // A combination with nothing scheduled still gets a valid empty calendar
    // rather than a 404, so a quiet month shows an empty calendar instead of
    // an error on somebody's phone.
    const file = comboSlug(combo.map((m) => m.id)) + '.ics';
    writeFileSync(join(dir, file), ics, 'utf8');
    wanted.add(file);
    written++;
    bytes += Buffer.byteLength(ics, 'utf8');
  }

  // A ministry going private, or off, retires the combinations containing it.
  let removed = 0;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ics') && !wanted.has(name)) {
        rmSync(join(dir, name));
        removed++;
      }
    }
  }

  return { written, removed, bytes, dir, tooBig: bytes > NOISY_ABOVE_BYTES };
}

/** Total size on disk, for the run log. These files multiply; it should be visible. */
export function comboBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((n) => n.endsWith('.ics'))
    .reduce((sum, n) => sum + statSync(join(dir, n)).size, 0);
}
