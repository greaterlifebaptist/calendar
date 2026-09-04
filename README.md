# GLBC Calendar Platform

One calendar system for Greater Life Baptist Church. Leaders edit in Google
Calendar; a job reads those calendars hourly and pushes the result out to a
website, subscribable `.ics` feeds, and GroupMe reminders.

Design decisions and their reasoning live in [CLAUDE.md](CLAUDE.md). Read that
first. Google, GitHub and DNS setup is in [docs/SETUP.md](docs/SETUP.md). This
file covers only how to run what exists.

## Status

Phase 1, step 1 of section 8 is built: **job core** — fetch, classify, and
publish `events.json` plus the bundle feeds.

| Step | State |
|---|---|
| 1. Job core | done |
| 2. Public site page | starting HTML in `site/index.html`, TV mode still to add |
| 3. Hourly workflow | written, waiting on the repo and secrets |
| 4. Reminder engine | not started |
| 5-9. Signup, personal feeds, prefs, admin, TV mode | not started |

## Run it

The job runs with no credentials at all, against sample events written the way
the church's leaders actually type them:

```bash
cd job && npm install && npm run dev
```

That writes `public/events.json` and `public/feeds/*.ics`. See the Preview
section below to view the page rendering them.

Against the real calendars, once `.env` is filled in from `.env.example`:

```bash
cd job && npm start
```

Checks:

```bash
cd job && npm run check
```

## Layout

```
site/index.html      calendar page, reads events.json
job/src/             the hourly job
job/config/          ministries.json — ids are locked, see CLAUDE.md section 3
job/fixtures/        sample Google API responses for credential-free runs
job/test/            classification, ICS, and privacy tests
public/              job output, served by GitHub Pages
```

## What the job does

1. Reads each enabled ministry calendar twice. Once expanded into dated
   occurrences for the website and the reminder ladder, once unexpanded so the
   `.ics` feeds keep their `RRULE` instead of exploding a weekly service into
   hundreds of entries.
2. Classifies every event as `deadline`, `trip`, `routine`, or `event`, and
   decides whether it is pinned. Inference does the work; nobody has to type
   metadata. See below.
3. Writes `events.json` and one `.ics` per public ministry, plus `all.ics`.

Files are only rewritten when their bytes change, so the hourly commit stays
quiet when nothing happened.

## Classification

Three paths, highest precedence first. All three land on the same shape.

**Extended properties** — what the admin form will write:
`glbcType` (`deadline` / `trip` / `routine` / `event`) and `glbcPinned`.

**Title prefixes** — for correcting a bad guess. Stripped before display.

| Prefix | Effect |
|---|---|
| `DUE:` | force deadline |
| `EVENT:` `TRIP:` `ROUTINE:` | force that type |
| `PIN:` / `NOPIN:` | force pinned / unpinned |

`EVENT:` is not in the original brief. It exists because the keyword rule has
false positives with no other escape hatch: "Money counters meeting" reads as a
deadline because of the word *money*, and `DUE:` cannot un-say that.

**Inference** — the default, requiring nothing of the person adding the event:

- a title containing due, deadline, deposit, form(s), rsvp, sign-up, last day,
  turn in, or money becomes a **deadline**
- an all-day event spanning two or more days becomes a **trip**, and is pinned
- weekly, biweekly, or daily recurrence becomes **routine**, never pinned
- a trip or deadline more than 60 days out is pinned
- everything else is an **event**

Optional description lines, parsed if present and never required:

```
cost: $75
link: Permission form https://example.org/form
contact: Bro. Spencer
```

## Privacy

`public/` is served by GitHub Pages, so everything in it is world-readable.
Private ministries never reach it — not `events.json`, not any bundle feed, not
the filter pills. `job/test/publish.test.ts` asserts this on every run, by id
and by searching the published bytes for private event text.

Private content will only leave via per-person token feeds, generated in the
same run from data held in memory. Those feeds are gitignored: they are written
into `public/f/` at run time and copied into the deployed site, but never
committed, so a public repo cannot expose one person's private-ministry events
to anyone reading the code.

## Secrets

Set these as GitHub Actions secrets. Never commit them.

| Secret | Where from |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP console. Grant it edit rights on each calendar and the Sheet. |
| `CAL_CHURCH`, `CAL_YOUTH`, `CAL_YOUTH_LEADERS` | Google Calendar > Settings > Integrate calendar |
| `SHEET_ID` | the Sheet URL |
| `GROUPME_BOT_YOUTH_PARENTS` | dev.groupme.com/bots |
| `ADMIN_PASSCODE` | chosen |

A calendar the service account has not been shared with returns 403. A calendar
id left blank is skipped with a warning rather than failing the run.

## Preview

Serves `site/` over `public/` from one origin, the way GitHub Pages will, so
the page fetches `events.json` and the feeds by their real paths:

```bash
node scripts/serve.mjs
```

In fixtures mode a recurring event shows only one occurrence, because Google
does the expanding and fixtures do not. Everything else renders as it will in
production.
