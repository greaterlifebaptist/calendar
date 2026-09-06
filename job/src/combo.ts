/**
 * The naming contract for merged feeds.
 *
 * There used to be a builder here that wrote one .ics for every combination of
 * public ministries, so that signing up handed over a URL that already existed
 * instead of one that 404s until the next deploy. That solved the wait and
 * created a worse problem: subsets are 2^n, so seven ministries is 127 files
 * and fifteen is 32,767, rebuilt and redeployed hourly for no gain. It ran out
 * at about eight ministries, which is one more than we have.
 *
 * The merge now happens on request, in worker/src/index.js, so nothing is
 * built in advance and the number of ministries stops mattering.
 *
 * What is left here is the naming rule, and the test that keeps three
 * independent implementations of it agreeing: this file, `comboSlug_` in
 * site/apps-script/Code.gs, and the site's own subscribe buttons. If they ever
 * disagree, somebody is handed an address that resolves to nothing.
 */

import type { Config, Ministry } from './types.ts';

/**
 * The URL-safe name for a set of ministries.
 *
 * Sorted, so the order somebody ticked the boxes in cannot produce a second
 * URL for the same calendar. Alphabetical rather than config order, so
 * reordering config/ministries.json cannot silently change everybody's link.
 *
 * Joined with "~" rather than "-" because ids may contain a hyphen and one of
 * them does: youth-leaders. It is private today, so a hyphen separator worked,
 * but ids are locked and the list is not fixed, so the day that ministry went
 * public "church-youth-leaders" would have had two readings and every saved
 * URL would have become ambiguous at once. "~" cannot appear in an id and is
 * unreserved in a URL, so this is settled permanently.
 */
export function comboSlug(ids: string[]): string {
  return [...new Set(ids)].sort().join('~');
}

/** The ministries a person may pick for themselves: public, and actually online. */
export function comboMinistries(cfg: Config): Ministry[] {
  return cfg.ministries
    .filter((m) => m.visibility === 'public' && m.calendarId)
    .sort((a, b) => a.id.localeCompare(b.id));
}
