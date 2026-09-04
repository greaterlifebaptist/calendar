# GLBC Calendar Platform

One calendar system for Greater Life Baptist Church. Leaders edit in Google
Calendar; a job reads those calendars hourly and pushes the result out to a
website, subscribable `.ics` feeds, and GroupMe reminders.

Design decisions and their reasoning live in [CLAUDE.md](CLAUDE.md). Read that
first. Google, GitHub and DNS setup is in [docs/SETUP.md](docs/SETUP.md), and
the agreed design for the overflow-room TV is in [docs/TV.md](docs/TV.md).
Backups and how to restore from one are in [docs/BACKUP.md](docs/BACKUP.md).
Deploying the signup endpoint is in [docs/SIGNUP.md](docs/SIGNUP.md).
This file covers only how to run what exists.

## Status

The job, the website, the hourly deploy, backups and personal feeds are live.
The remaining work is the pages people interact with, then reminders.

| Step | State |
|---|---|
| 1. Job core | done |
| 2. Public site page | done — TV mode, add to home screen, cached fallback |
| 3. Hourly workflow | live |
| 4. Membership sheet and personal feeds | done |
| 5. Signup page | live |
| 6. Preferences page | built, needs the endpoint redeployed |
| 7. Admin form | |
| 8. TV display for the 85 inch screen | |
| 9. Reminder engine to GroupMe | |

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
site/signup.html     pick your groups, get your personal link and QR
site/prefs.html      change your groups later, or replace a leaked link
site/apps-script/    the endpoint that writes to the membership sheet
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
4. Snapshots every calendar verbatim into `backup/`, private ones included,
   which the workflow pushes to a separate private repository.

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
- a trip or deadline more than 60 days out is pinned
- everything else is an **event**, recurring ones included

Recurrence does not imply routine. These calendars only carry what people need
to pay attention to, so a weekly series here is a four-night revival or a
six-week class, and it needs reminders like anything else. `routine` exists for
a genuine standing fixture but has to be asked for with a `ROUTINE:` prefix.

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
| `SHEET_ID` | the Sheet URL |
| `GROUPME_BOT_YOUTH_PARENTS` | dev.groupme.com/bots |
| `ADMIN_PASSCODE` | chosen |

Calendar ids are not secrets and live in `job/config/ministries.json`. The
calendars are not public, so an id grants nothing without the service account
being shared onto that calendar. A ministry whose `calendarId` is blank is
skipped entirely: no feed, no filter pill. Pasting the id brings it online.

A calendar the service account has not been shared with returns 403 and fails
the run loudly, which is what you want.

## Preview

Serves `site/` over `public/` from one origin, the way GitHub Pages will, so
the page fetches `events.json` and the feeds by their real paths:

```bash
node scripts/serve.mjs
```

In fixtures mode a recurring event shows only one occurrence, because Google
does the expanding and fixtures do not. Everything else renders as it will in
production.

## The website page

`site/index.html` reads `events.json` and needs no build step.

| URL | What it does |
|---|---|
| `/` | agenda, pinned rail, month grid, ministry filters |
| `/?ministry=youth` | opens filtered to one or more ministries, comma separated |
| `/?display=tv` | TV mode |

**TV mode** is for the wall tablets replacing the paper calendar cards. Large
type, two columns on a wide screen, no filters or tabs or subscribe panel, a
running clock, a refresh every fifteen minutes, and a screen wake lock so the
tablet does not sleep. It re-fetches rather than reloading, because a reload
during a network blip would leave a blank wall.

**When the data cannot be loaded** the page falls back in this order:

1. The last copy this device fetched successfully, labelled and dated.
2. The built-in sample, labelled clearly as an example.

The brief asked for a fallback so the page never goes blank. Showing invented
events as though they were real is worse than blank, so the fallback is real
data where possible and always says which it is. A response that returns HTTP
200 but is not shaped like `events.json` is rejected rather than trusted.

The page also warns when live data is more than a day old. Feeds refresh
hourly, so anything older means the job has stopped and the reader should not
trust the dates.

## Ministries that are not in use

A calendar can exist in Google without anyone ever putting anything in it. A
ministry with nothing coming up is not listed in `events.json`, so it is not
offered as a filter or a subscription and the page never shows a pill leading
to an empty calendar. It reappears by itself when somebody schedules something.

Only the listing is withheld. The `.ics` file is still written every run,
because anyone already subscribed would otherwise find their feed returning 404
during a quiet stretch.

## Membership and personal feeds

Membership lives in a Google Sheet called **Calendar Permissions**, on a tab
named `People`. Columns are matched by their **header name**, never by
position, so a leader can reorder or insert columns without breaking anything.

| Column | Who fills it |
|---|---|
| `name` | the signup page, or `npm run person` |
| `email` | optional, same |
| `token` | **generated, never typed** |
| `created` | generated |
| one column per ministry id | any non-empty value means member |

`token` is 128 bits of randomness and becomes that person's feed URL. Nobody
types it and nobody should invent one. The brief sketched an eight character
token; that is only 32 bits, and since the feeds sit on a public host an
attacker would not be guessing one person's token, they would be sweeping for
any valid one. With a few hundred members that is days of scripted requests.

Every run rebuilds every personal feed from the sheet. Clearing a ministry
column drops that content from the person's next refresh, and deleting their
row removes the feed entirely. That is the revocation mechanism, and it is why
nothing genuinely sensitive belongs in any feed.

Personal feeds are the only path by which a private ministry's events leave the
system.

### Adding somebody before the signup page exists

```bash
cd job && npm run person -- --list
```

```bash
cd job && npm run person -- --add "Jane Doe" --groups church,youth
```

This is also the permanent mechanism for **private** groups. The signup page
must never let somebody add themselves to `youth-leaders` or `worship`, so a
leader does it here. Needs `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` in a
local `.env`.

A sheet that cannot be read fails the run rather than publishing. That means
the site keeps serving its previous copy for an hour and an issue is opened,
which is better than quietly serving stale personal feeds to people who should
have been removed from them.
