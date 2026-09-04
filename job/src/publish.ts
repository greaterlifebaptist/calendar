/**
 * Writes the job's output: events.json for the website and one .ics bundle
 * per public ministry, plus a combined all.ics.
 *
 * Private ministries never reach this directory. `public/` is served by
 * GitHub Pages, so anything written here is world-readable by definition
 * (CLAUDE.md section 10). Private content only ever leaves via a personal
 * token feed, generated later in the same run from in-memory data.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CalEvent, Config, EventsJson, Ministry, PublicEvent } from './types.ts';
import { outputDir, calendarIdFor } from './config.ts';
import { buildIcs, ministryCalendarName, toIcsInputs } from './ics.ts';
import { isoDate, isoLocal } from './time.ts';

export type PublishResult = {
  eventsJsonPath: string;
  feedPaths: string[];
  publicEventCount: number;
  privateEventCount: number;
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Only rewrite when the bytes change, so the hourly commit stays quiet. */
function writeIfChanged(path: string, contents: string): boolean {
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8');
    if (current === contents) return false;
  }
  writeFileSync(path, contents, 'utf8');
  return true;
}

/**
 * events.json carries local wall-clock strings with no offset. The website
 * parses them as local time, which is what a reader in Midland expects to
 * see regardless of the timezone their phone is set to.
 */
export function toPublicEvent(ev: CalEvent, tz: string): PublicEvent {
  const out: PublicEvent = {
    uid: ev.iCalUID || ev.id,
    ministry: ev.ministry,
    type: ev.type,
    title: ev.title,
    start: ev.allDay ? isoDate(new Date(ev.startInstant), tz) : isoLocal(new Date(ev.startInstant), tz),
  };
  if (ev.pinned) out.pinned = true;
  if (ev.allDay) {
    out.allDay = true;
    // Google's exclusive end date reads badly in a UI; make it inclusive, and
    // leave it off single-day events so the site says "All day" not "Sep 30 - Sep 30".
    if (ev.end?.date && ev.end.date !== ev.start.date) {
      const last = isoDate(new Date(new Date(ev.endInstant).getTime() - 86400000), tz);
      if (last !== out.start) out.end = last;
    }
  } else if (ev.end?.dateTime) {
    out.end = isoLocal(new Date(ev.endInstant), tz);
  }
  if (ev.location) out.location = ev.location;
  if (ev.notes) out.notes = ev.notes;
  if (ev.cost) out.cost = ev.cost;
  if (ev.contact) out.contact = ev.contact;
  if (ev.link) {
    out.link = ev.link;
    out.linkText = ev.linkText ?? 'Details';
  }
  return out;
}

export function isPublic(cfg: Config, ministryId: string): boolean {
  const m = cfg.ministries.find((x) => x.id === ministryId);
  return Boolean(m && m.visibility === 'public');
}

export type PublishInput = {
  cfg: Config;
  ministries: Ministry[];
  /** Dated occurrences, for the website. */
  instances: CalEvent[];
  /** Recurrence masters and exceptions, for the .ics feeds. */
  masters: CalEvent[];
  generated?: Date;
};

export function publish(input: PublishInput): PublishResult {
  const { cfg, ministries, instances, masters } = input;
  const tz = cfg.timezone;
  const generated = input.generated ?? new Date();

  const root = outputDir();
  const feedsDir = join(root, 'feeds');
  ensureDir(root);
  ensureDir(feedsDir);

  // A cancelled occurrence only exists so the .ics can carry an EXDATE.
  const live = instances.filter((e) => e.status !== 'cancelled');
  const publicInstances = live.filter((e) => isPublic(cfg, e.ministry));
  const privateCount = live.length - publicInstances.length;

  // A calendar can exist in Google without ever being used. A ministry that
  // has nothing coming up is not offered as a filter or a subscription, so
  // the page never shows a pill leading to an empty calendar. It reappears on
  // its own the moment somebody schedules something.
  //
  // Only the listing is withheld. The .ics file is still written, because
  // anyone already subscribed would otherwise find their feed 404 during a
  // quiet stretch.
  const inUse = new Set(
    publicInstances
      .filter((e) => new Date(e.endInstant).getTime() >= generated.getTime())
      .map((e) => e.ministry),
  );
  const publicMinistries = ministries.filter((m) => m.visibility === 'public');
  const listed = publicMinistries.filter((m) => inUse.has(m.id));

  // ---- events.json ----
  const events: EventsJson = {
    generated: generated.toISOString(),
    timezone: tz,
    feeds: {
      base: cfg.site.feedBase,
      all: cfg.site.allFeed,
      personal: cfg.site.personalFeedBase,
    },
    signup: cfg.site.signupEndpoint || '',
    // When nothing at all is scheduled, list nothing. Offering every ministry
    // as a filter with no events behind any of them is worse than an honest
    // empty page, which is what the site renders instead.
    ministries: listed.map((m) => ({ id: m.id, name: m.name, color: m.color })),
    events: publicInstances.map((e) => toPublicEvent(e, tz)),
  };
  const eventsJsonPath = join(root, 'events.json');
  writeIfChanged(eventsJsonPath, JSON.stringify(events, null, 2) + '\n');

  // ---- ministries.json ----
  // Every ministry, private ones included, for the admin form. It is the one
  // place that needs to schedule onto a private calendar, and it is gated by a
  // passcode rather than by this file being hard to find.
  //
  // The calendar ids are here too. They are not credentials: the calendars are
  // not public, so reading one requires the service account to have been shared
  // onto it. They already sit in the public repo, so this adds no exposure and
  // keeps one source of truth rather than a copy inside the script.
  writeIfChanged(
    join(root, 'ministries.json'),
    JSON.stringify(
      {
        generated: generated.toISOString(),
        ministries: ministries.map((m) => ({
          id: m.id,
          name: m.name,
          visibility: m.visibility,
          color: m.color,
          calendarId: calendarIdFor(m) ?? '',
          contact: m.contact ?? '',
        })),
      },
      null,
      2,
    ) + '\n',
  );

  // ---- per-ministry bundle feeds ----
  const feedPaths: string[] = [];
  const wanted = new Set<string>();

  for (const m of ministries) {
    if (m.visibility !== 'public') continue;
    const mine = masters.filter((e) => e.ministry === m.id);
    const ics = buildIcs(toIcsInputs(mine, tz), cfg, {
      name: ministryCalendarName(m),
      description: 'Greater Life Baptist Church — ' + m.name,
    });
    const path = join(feedsDir, m.id + '.ics');
    wanted.add(m.id + '.ics');
    writeIfChanged(path, ics);
    feedPaths.push(path);
  }

  // ---- combined public feed ----
  const allPublicMasters = masters.filter((e) => isPublic(cfg, e.ministry));
  const allIcs = buildIcs(toIcsInputs(allPublicMasters, tz), cfg, {
    name: 'GLBC — Everything',
    description: 'Greater Life Baptist Church — all public ministries',
  });
  const allPath = join(feedsDir, cfg.site.allFeed);
  wanted.add(cfg.site.allFeed);
  writeIfChanged(allPath, allIcs);
  feedPaths.push(allPath);

  // A ministry that is turned off or made private must stop being served.
  for (const name of readdirSync(feedsDir)) {
    if (name.endsWith('.ics') && !wanted.has(name)) rmSync(join(feedsDir, name));
  }

  return {
    eventsJsonPath,
    feedPaths,
    publicEventCount: publicInstances.length,
    privateEventCount: privateCount,
  };
}
