/** Loads config/ministries.json and resolves per-ministry calendar IDs. */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Config, Ministry } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, i.e. the directory holding /job, /site and /public. */
export const ROOT = resolve(here, '..', '..');
export const JOB_DIR = resolve(here, '..');
export const PUBLIC_DIR = join(ROOT, 'public');

/**
 * Where the job writes its output.
 *
 * A fixture run must not clobber public/, which holds the real published data
 * and is committed. Otherwise `npm run dev` leaves sample events staged for
 * commit and every later pull conflicts on generated files.
 */
export function outputDir(): string {
  return USE_FIXTURES() ? join(ROOT, '.dev-site') : PUBLIC_DIR;
}

/** Load .env from the repo root if present. Never required in CI. */
export function loadDotEnv(): void {
  for (const candidate of [join(ROOT, '.env'), join(JOB_DIR, '.env')]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed .env should not take the job down; env vars still win.
    }
  }
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const path = join(JOB_DIR, 'config', 'ministries.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Config;

  const seen = new Set<string>();
  for (const m of parsed.ministries) {
    if (seen.has(m.id)) throw new Error(`Duplicate ministry id: ${m.id}`);
    seen.add(m.id);
    if (!/^[a-z][a-z0-9-]*$/.test(m.id)) {
      throw new Error(`Ministry id must be lowercase kebab-case: ${m.id}`);
    }
  }

  cached = parsed;
  return parsed;
}

/**
 * The Google calendar ID for a ministry.
 *
 * A calendar id is not a credential. The calendars are not public, so reading
 * one requires the service account to have been shared onto it; knowing the id
 * grants nothing. So the ids live in ministries.json, where they are visible,
 * reviewable and changed by a commit, rather than as nine separate secrets
 * that have to be typed correctly into a web form.
 *
 * An environment variable still wins, so a calendar can be repointed in an
 * emergency without a deploy.
 */
export function calendarIdFor(m: Ministry): string | null {
  const fromEnv = process.env[m.calendarIdEnv]?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = m.calendarId?.trim();
  return fromConfig ? fromConfig : null;
}

/**
 * Ministries that are switched on and actually point at a calendar.
 *
 * A ministry with no id yet is simply not active: it produces no feed and no
 * filter pill, rather than an empty pill leading to an empty calendar. Pasting
 * the id into ministries.json is the only step needed to bring one online.
 */
export function activeMinistries(cfg: Config): Ministry[] {
  return cfg.ministries.filter((m) => m.enabled && calendarIdFor(m));
}

/** Switched on but still waiting for a calendar id. Reported, never fatal. */
export function pendingMinistries(cfg: Config): Ministry[] {
  return cfg.ministries.filter((m) => m.enabled && !calendarIdFor(m));
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const flag = (name: string): boolean => process.argv.slice(2).includes('--' + name);
const envOn = (name: string): boolean => /^(1|true|yes)$/i.test(process.env[name] ?? '');

/** Log what would be sent instead of sending it. Required before going live. */
export const DRY_RUN = (): boolean => envOn('DRY_RUN') || flag('dry-run');

/** Run the whole pipeline off local sample data, with no Google credentials. */
export const USE_FIXTURES = (): boolean => envOn('FIXTURES') || flag('fixtures');
