/**
 * Per-person .ics feeds.
 *
 * This is the only path by which a private ministry's events leave the system.
 * A person picks their groups once and gets one calendar containing all of
 * them, because people already carry six calendars on their phone and will not
 * add five more.
 *
 * The files are written into the deploy output but never committed. Removing
 * someone's row, or clearing one of their columns, drops that content from
 * their next refresh: that is the revocation mechanism, and it is why nothing
 * genuinely sensitive belongs in any feed.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CalEvent, Config } from './types.ts';
import type { Person } from './sheet.ts';
import { buildIcs, toIcsInputs } from './ics.ts';

export type PersonalResult = {
  written: number;
  removed: number;
  empty: number;
  dir: string;
};

/**
 * What this calendar is called on somebody's phone.
 *
 * Not their own name. They know who they are; what they need to recognise in a
 * list of six calendars is the church. An earlier version used the first name
 * from the sheet, which produced "GLBC — Test" and told the reader nothing.
 */
const CALENDAR_NAME = 'Greater Life Baptist Church';

export function writePersonalFeeds(
  cfg: Config,
  people: Person[],
  masters: CalEvent[],
  outRoot: string,
): PersonalResult {
  const dir = join(outRoot, 'f');
  mkdirSync(dir, { recursive: true });

  const known = new Map(cfg.ministries.map((m) => [m.id, m]));
  const wanted = new Set<string>();
  let written = 0;
  let empty = 0;

  for (const person of people) {
    // Only groups that still exist in config. A column left over from a
    // renamed ministry must not silently include anything.
    const groups = new Set(person.groups.filter((g) => known.has(g)));
    const mine = masters.filter((e) => groups.has(e.ministry));

    const ics = buildIcs(toIcsInputs(mine, cfg.timezone), cfg, {
      name: CALENDAR_NAME,
      description:
        'Greater Life Baptist Church — ' +
        (groups.size ? [...groups].map((g) => known.get(g)!.name).join(', ') : 'no groups selected'),
    });

    // Somebody who has unticked everything still gets a valid empty calendar
    // rather than a 404, so their phone shows nothing instead of an error.
    if (!mine.length) empty++;

    const file = person.token + '.ics';
    writeFileSync(join(dir, file), ics, 'utf8');
    wanted.add(file);
    written++;
  }

  // A token no longer in the sheet stops being served. This is what makes
  // deleting a row an actual revocation rather than a gesture.
  let removed = 0;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ics') && !wanted.has(name)) {
        rmSync(join(dir, name));
        removed++;
      }
    }
  }

  return { written, removed, empty, dir };
}
