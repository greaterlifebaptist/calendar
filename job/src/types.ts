/** Shared types for the GLBC calendar job. */

export type EventType = 'deadline' | 'trip' | 'routine' | 'event';

export type Visibility = 'public' | 'private';

export type Ministry = {
  id: string;
  name: string;
  visibility: Visibility;
  enabled: boolean;
  color: string;
  /** Google calendar id. Not a credential: the calendars are not public. */
  calendarId: string;
  /** Env var that overrides calendarId, for repointing without a deploy. */
  calendarIdEnv: string;
  /** Suggested contact for this ministry, offered by the admin form. */
  contact?: string;
  notify: string[];
  reminders: Partial<Record<EventType, string[]>> | null;
};

export type Channel = {
  kind: 'groupme';
  label: string;
  botIdEnv: string;
};

export type Config = {
  timezone: string;
  site: {
    feedBase: string;
    personalFeedBase: string;
    allFeed: string;
    /** Deployed Apps Script web app. Blank until it exists. */
    signupEndpoint?: string;
  };
  reminderDefaults: Record<EventType, string[]>;
  recurringSeries: { frequentFollowUp: string[] };
  reminderSchedule: {
    sendHour: number;
    digest: { weekday: number; hour: number };
    maxPerRun: number;
  };
  ministries: Ministry[];
  channels: Record<string, Channel>;
};

/**
 * A Google Calendar event as we care about it, before classification.
 * Mirrors the subset of the REST v3 `Event` resource the job uses.
 */
export type RawEvent = {
  ministry: string;
  id: string;
  iCalUID: string;
  status?: string;
  sequence?: number;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  /** RFC3339 date-time, or YYYY-MM-DD for all-day. */
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  /** RRULE / EXDATE / RDATE lines, present only on recurrence masters. */
  recurrence?: string[];
  /** Set on instances that override or cancel part of a recurring series. */
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: {
    shared?: Record<string, string>;
    private?: Record<string, string>;
  };
};

/** The result of running a RawEvent through classify(). */
export type Classified = {
  type: EventType;
  pinned: boolean;
  /** Title with any DUE:/PIN:/NOPIN: prefix stripped. */
  title: string;
  /** Description with cost:/link:/contact: lines removed, plain text. */
  notes: string;
  cost: string | null;
  link: string | null;
  linkText: string | null;
  contact: string | null;
  /** Which path decided the type — useful when auditing misclassification. */
  reason: string;
};

/** A fully processed event: raw data plus classification. */
export type CalEvent = RawEvent & Classified & {
  allDay: boolean;
  /** ISO instant for sorting and reminder math. */
  startInstant: string;
  endInstant: string;
  isRecurringMaster: boolean;
};

/** Re-exported so consumers get Person from one place. */
export type { Person } from './sheet.ts';
export type { ReminderState, PlannedReminder } from './remind.ts';

/** The shape written to public/events.json and read by the website. */
export type EventsJson = {
  generated: string;
  timezone: string;
  feeds: { base: string; all: string; personal: string };
  /** Signup endpoint, so the pages need no separate config file. */
  signup?: string;
  ministries: { id: string; name: string; color: string }[];
  events: PublicEvent[];
};

export type PublicEvent = {
  uid: string;
  ministry: string;
  type: EventType;
  pinned?: boolean;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  cost?: string;
  contact?: string;
  link?: string;
  linkText?: string;
};
