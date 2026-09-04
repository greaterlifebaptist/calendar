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

/** Ministries switched on for this phase. */
export function activeMinistries(cfg: Config): Ministry[] {
  return cfg.ministries.filter((m) => m.enabled);
}

/**
 * The Google calendar ID for a ministry, from its configured env var.
 * Returns null when the calendar has not been created yet, which is a
 * skip-with-a-warning condition rather than a failure.
 */
export function calendarIdFor(m: Ministry): string | null {
  const raw = process.env[m.calendarIdEnv];
  const value = raw?.trim();
  return value ? value : null;
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
