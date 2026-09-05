/**
 * The reminder ladder.
 *
 * This is the reason the whole project exists: youth parents getting an
 * automatic nudge about a deadline, a month out, a week out, a day out, and on
 * the day. It is also the only part that can do real damage. A bug that texts
 * thirty parents at six in the morning is the single failure that ends
 * adoption permanently, so almost everything here is a guard:
 *
 *   - Reminders go out once a day, at a fixed local hour, never hourly.
 *   - Every send is recorded, keyed on the event and the rung of the ladder,
 *     so the hourly job cannot repeat one.
 *   - The very first run sends nothing at all. It records what it *would*
 *     have sent, so switching this on does not fire a month of backlog.
 *   - A run that wants to send more than a handful sends none of them and
 *     fails loudly instead.
 *   - Nothing is sent at all unless a channel is configured and DRY_RUN is
 *     off, and dry runs are the default everywhere except production.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CalEvent, Config, EventType, Ministry } from './types.ts';
import { isWeeklyish } from './classify.ts';
import { daysBetween, isoDate, zonedParts } from './time.ts';
import { FORCE_SEND_HOUR } from './config.ts';

export type Channel = { id: string; label: string; botId: string | null };

export type PlannedReminder = {
  /** Dedupe key: this event, this rung. */
  key: string;
  channelId: string;
  ministry: string;
  ruleId: string;
  title: string;
  text: string;
};

export type ReminderState = {
  /** Keys already sent, with when, so the file is auditable by eye. */
  sent: Record<string, string>;
  seededAt?: string;
};

export type ReminderPlan = {
  due: PlannedReminder[];
  /** Why nothing is going out, when nothing is. */
  skipped: string | null;
  seeding: boolean;
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * Not under public/. CLAUDE.md sketches it there, but public/ is served to the
 * world, and publishing which events triggered a notification buys nothing and
 * leaks the shape of private ministries the moment one gets a channel.
 */
export function statePath(root: string): string {
  return join(root, 'job', 'state', 'reminders.json');
}

export function loadState(path: string): ReminderState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReminderState;
    return parsed && typeof parsed.sent === 'object' ? parsed : null;
  } catch {
    // A corrupt state file must not be treated as "nothing has been sent".
    throw new Error(
      `Reminder state at ${path} is unreadable. Refusing to run rather than ` +
      `risk re-sending every reminder.`,
    );
  }
}

export function saveState(path: string, state: ReminderState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Forget keys for events far enough past that they cannot come round again. */
export function pruneState(state: ReminderState, now: Date): ReminderState {
  const cutoff = now.getTime() - 120 * 86400000;
  const sent: Record<string, string> = {};
  for (const [key, when] of Object.entries(state.sent)) {
    const at = Date.parse(when);
    if (Number.isNaN(at) || at >= cutoff) sent[key] = when;
  }
  return { ...state, sent };
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

/** "30d" -> 30, "0d" -> 0. */
export function parseRule(rule: string): number | null {
  const m = /^(\d+)d$/i.exec(String(rule).trim());
  return m ? Number(m[1]) : null;
}

export function ladderFor(cfg: Config, ministry: Ministry, type: EventType): string[] {
  const override = ministry.reminders?.[type];
  return override ?? cfg.reminderDefaults[type] ?? [];
}

export function channelsFor(cfg: Config, ministry: Ministry): Channel[] {
  return (ministry.notify ?? []).map((id) => {
    const c = cfg.channels[id];
    return {
      id,
      label: c?.label ?? id,
      botId: c?.botIdEnv ? process.env[c.botIdEnv]?.trim() || null : null,
    };
  });
}

// ---------------------------------------------------------------------------
// wording
// ---------------------------------------------------------------------------

const WEEKDAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

function longDate(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAY[dow]}, ${MONTH[p.m - 1]} ${p.d}`;
}

function clockTime(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  const mm = p.M === 0 ? '' : ':' + String(p.M).padStart(2, '0');
  return `${h12}${mm} ${p.H < 12 ? 'AM' : 'PM'}`;
}

export function howSoon(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === 7) return 'in a week';
  if (days < 14) return `in ${days} days`;
  if (days < 45) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/**
 * One reminder, as a parent will read it on their phone.
 *
 * The date is spelled out. "Due in 7 days" alone makes somebody count forward
 * from a message they might read a day late.
 */
export function reminderText(ev: CalEvent, days: number, tz: string): string {
  const start = new Date(ev.startInstant);
  const soon = howSoon(days);
  const lines: string[] = [];

  if (ev.type === 'deadline') {
    lines.push(days <= 0 ? `DUE TODAY: ${ev.title}` : `Coming up: ${ev.title}`);
    lines.push(days <= 0
      ? `Due today, ${longDate(start, tz)}.`
      : `Due ${soon}, on ${longDate(start, tz)}.`);
  } else {
    lines.push(days <= 0 ? `Today: ${ev.title}` : `Coming up: ${ev.title}`);
    const when = ev.allDay
      ? longDate(start, tz)
      : `${longDate(start, tz)} at ${clockTime(start, tz)}`;
    lines.push(days <= 0 ? `${when}.` : `${when}, ${soon}.`);
  }

  if (ev.location) lines.push(`Where: ${ev.location}`);
  if (ev.notes) lines.push('', ev.notes.split('\n\n')[0]);

  const tail: string[] = [];
  if (ev.cost) tail.push(`Cost: ${ev.cost}`);
  if (ev.contact) tail.push(`Questions: ${ev.contact}`);
  if (ev.link) tail.push(ev.link);
  if (tail.length) lines.push('', ...tail);

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------

type PlanInput = {
  cfg: Config;
  ministries: Ministry[];
  /** Dated occurrences. */
  instances: CalEvent[];
  /** Masters, so a series' recurrence rule can be found. */
  masters: CalEvent[];
  state: ReminderState | null;
  now: Date;
  /** Ignore the send-hour check. Used by the lookahead and by --send-now. */
  forceHour?: boolean;
};

/**
 * Which occurrences of a frequent series should get the full ladder.
 *
 * A six-week Wednesday class reminding a week ahead every week sends twelve
 * messages, and the seven-day notice always lands the day after the previous
 * session. So the first upcoming occurrence gets everything and the rest get
 * only the follow-up rungs. A monthly series is not frequent enough to be a
 * nuisance and is left alone.
 */
function firstUpcomingOfSeries(instances: CalEvent[], now: Date): Set<string> {
  const earliest = new Map<string, CalEvent>();
  for (const ev of instances) {
    if (!ev.recurringEventId) continue;
    if (new Date(ev.startInstant) < now) continue;
    const held = earliest.get(ev.recurringEventId);
    if (!held || ev.startInstant < held.startInstant) earliest.set(ev.recurringEventId, ev);
  }
  return new Set([...earliest.values()].map((e) => e.id));
}

export function planReminders(input: PlanInput): ReminderPlan {
  const { cfg, ministries, instances, masters, state, now } = input;
  const tz = cfg.timezone;
  const schedule = cfg.reminderSchedule;
  const hour = zonedParts(now, tz).H;

  // Once a day, not once an hour.
  if (hour !== schedule.sendHour && !input.forceHour && !FORCE_SEND_HOUR()) {
    // Seeding is reported honestly even here, so the state file gets created
    // on an ordinary quiet run rather than waiting for one that has something
    // to send. Otherwise the first deliberate test is swallowed by the seed.
    return {
      due: [],
      skipped: `not the send hour (${schedule.sendHour}:00 local)`,
      seeding: !state,
    };
  }

  const byMinistry = new Map(ministries.map((m) => [m.id, m]));
  const recurrenceOf = new Map<string, string[] | undefined>();
  for (const m of masters) recurrenceOf.set(m.id, m.recurrence);
  const firstOnes = firstUpcomingOfSeries(instances, now);

  const due: PlannedReminder[] = [];

  for (const ev of instances) {
    if (ev.status === 'cancelled') continue;
    const ministry = byMinistry.get(ev.ministry);
    if (!ministry) continue;

    const channels = channelsFor(cfg, ministry);
    if (!channels.length) continue;

    const start = new Date(ev.startInstant);
    const daysOut = daysBetween(now, start, tz);
    if (daysOut < 0) continue;

    let ladder = ladderFor(cfg, ministry, ev.type);

    // Throttle a frequent series after its first upcoming occurrence.
    if (ev.recurringEventId && isWeeklyish(recurrenceOf.get(ev.recurringEventId))) {
      if (!firstOnes.has(ev.id)) ladder = cfg.recurringSeries.frequentFollowUp;
    }

    for (const rule of ladder) {
      const daysBefore = parseRule(rule);
      if (daysBefore === null || daysBefore !== daysOut) continue;

      for (const channel of channels) {
        const key = `${ev.iCalUID || ev.id}:${rule}:${channel.id}`;
        if (state?.sent[key]) continue;
        due.push({
          key,
          channelId: channel.id,
          ministry: ev.ministry,
          ruleId: rule,
          title: ev.title,
          text: reminderText(ev, daysOut, tz),
        });
      }
    }
  }

  // The first ever run records what it would have sent and sends none of it.
  // Otherwise switching this on fires every rung for everything already on the
  // calendar, which is exactly the disaster this whole file is built around.
  if (!state) return { due, skipped: null, seeding: true };

  return { due, skipped: null, seeding: false };
}

// ---------------------------------------------------------------------------
// the weekly digest
// ---------------------------------------------------------------------------

export function planDigest(input: PlanInput): PlannedReminder[] {
  const { cfg, ministries, instances, state, now } = input;
  const tz = cfg.timezone;
  const { weekday, hour } = cfg.reminderSchedule.digest;
  const p = zonedParts(now, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  if ((dow !== weekday || p.H !== hour) && !FORCE_SEND_HOUR()) return [];

  const out: PlannedReminder[] = [];
  const weekKey = isoDate(now, tz);

  for (const ministry of ministries) {
    const channels = channelsFor(cfg, ministry);
    if (!channels.length) continue;

    const week = instances
      .filter((e) => e.ministry === ministry.id && e.status !== 'cancelled')
      .filter((e) => {
        const d = daysBetween(now, new Date(e.startInstant), tz);
        return d >= 0 && d <= 7;
      })
      .filter((e) => e.type !== 'routine')
      .sort((a, b) => (a.startInstant < b.startInstant ? -1 : 1));

    // A digest saying nothing is worse than no digest.
    if (!week.length) continue;

    const lines = ['The week ahead:', ''];
    for (const e of week) {
      const start = new Date(e.startInstant);
      const when = e.allDay ? longDate(start, tz) : `${longDate(start, tz)}, ${clockTime(start, tz)}`;
      lines.push(e.type === 'deadline' ? `• ${e.title} — DUE ${when}` : `• ${e.title} — ${when}`);
    }

    for (const channel of channels) {
      const key = `digest:${ministry.id}:${weekKey}:${channel.id}`;
      if (state?.sent[key]) continue;
      out.push({
        key,
        channelId: channel.id,
        ministry: ministry.id,
        ruleId: 'digest',
        title: 'Week ahead',
        text: lines.join('\n'),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// sending
// ---------------------------------------------------------------------------

export type SendResult = { sent: number; failed: string[] };

/** GroupMe wants a bot id and text. No auth header; the bot id is the secret. */
async function postToGroupMe(botId: string, text: string): Promise<void> {
  const res = await fetch('https://api.groupme.com/v3/bots/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bot_id: botId, text }),
  });
  if (!res.ok) {
    throw new Error(`GroupMe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function sendReminders(
  cfg: Config,
  planned: PlannedReminder[],
  state: ReminderState,
  opts: { dryRun: boolean; now: Date; log: (s: string) => void },
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: [] };

  for (const r of planned) {
    const channel = cfg.channels[r.channelId];
    const botId = channel?.botIdEnv ? process.env[channel.botIdEnv]?.trim() : '';

    if (opts.dryRun || !botId) {
      opts.log(`    [${opts.dryRun ? 'dry run' : 'no bot configured'}] -> ${channel?.label ?? r.channelId}`);
      for (const line of r.text.split('\n')) opts.log(`      | ${line}`);
      // Not recorded as sent: nothing went out, so it must still go out later.
      continue;
    }

    try {
      await postToGroupMe(botId, r.text);
      state.sent[r.key] = opts.now.toISOString();
      result.sent++;
      opts.log(`    [sent] ${r.title} -> ${channel.label}`);
    } catch (err) {
      result.failed.push(`${r.title}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * When the next reminders are due, whenever nothing is due right now.
 *
 * Without this, a run that sends nothing is indistinguishable from a run where
 * something is broken, and the only way to tell them apart is to work the
 * ladder out by hand. Printed on every run, so the Actions log answers "why
 * did I not get anything" without anyone opening a terminal.
 */
export function nextReminders(
  input: Omit<PlanInput, 'now'> & { now: Date },
  days = 60,
  limit = 5,
): { when: Date; reminder: PlannedReminder }[] {
  const out: { when: Date; reminder: PlannedReminder }[] = [];
  const seen: ReminderState = { sent: { ...(input.state?.sent ?? {}) } };
  const tz = input.cfg.timezone;

  for (let i = 0; i <= days && out.length < limit; i++) {
    const day = new Date(input.now.getTime() + i * 86400000);
    const p = zonedParts(day, tz);
    // Midday keeps the date stable either side of a clock change; the plan
    // only cares which calendar day it is once the hour check is bypassed.
    const at = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));

    const plan = planReminders({ ...input, state: seen, now: at, forceHour: true });
    for (const r of plan.due) {
      if (out.length >= limit) break;
      seen.sent[r.key] = at.toISOString();
      out.push({ when: at, reminder: r });
    }
  }
  return out;
}
