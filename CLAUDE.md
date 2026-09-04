# GLBC Calendar Platform — Project Brief

**Read this fully before writing code.** Architecture decisions below are already
settled after extensive planning. Don't relitigate them; if something seems wrong,
raise it before building, not after.

---

## 1. What this is

Greater Life Baptist Church (Midland, GA) needs one calendar system that serves
every ministry. It started as a youth-group problem — parents and leaders missing
permission-form deadlines, fundraiser due dates, and trip planning — and grew into
a church-wide platform.

**The core problem is distribution, not scheduling.** Google Calendar is a fine
database. What's missing is something that reads it and *pushes* on a schedule,
and a way for people to see everything relevant to them in one place.

**Primary user need (never lose sight of this):** youth parents get automatic
GroupMe reminders about deadlines, on a ladder — 1 month, 1 week, 1 day before,
day of.

---

## 2. Settled architecture

```
Leaders edit in Google Calendar (app/web) OR the admin web form
        │
        │  Google Calendar API (service account) — read + write
        ▼
Job (TypeScript, hourly via GitHub Actions cron)
        │
        ├──►  events.json           →  public website
        ├──►  per-ministry .ics     →  bundle subscriptions
        ├──►  per-person .ics       →  personal subscriptions (token URL)
        └──►  reminder engine       →  GroupMe bot (youth parents)

Membership + subscriptions live in a Google Sheet (Sheets API).
Everything published to calendars.greaterlifebaptistchurch.com (GitHub Pages).
Public URL people actually see: greaterlifebaptistchurch.com/calendar
```

### Why these choices

- **Google Calendar is the system of record.** It gives us for free the most
  expensive thing to build: a real editing UI, native mobile apps, offline edits,
  recurrence handling, and per-calendar permissions. Do not build a calendar store.
- **Personal generated feeds.** Users must NOT subscribe to raw Google calendars.
  A person picks their groups once and gets ONE `.ics` containing all of them.
  Requirement driver: people are already carrying 6 calendars on their phone and
  will not add five more.
- **Google Sheet as the database.** Leaders already know Sheets. Free, has revision
  history, and per-column protected ranges give each ministry lead edit rights to
  only their own group's membership. No admin UI to build. Migrate to a real DB
  only if it outgrows a few hundred rows.
- **Static hosting.** Site stays on SiteGround for now (WordPress page fetches from
  the subdomain). Possible move to Azure Static Web Apps later — the subdomain
  indirection means that move is a DNS change and nothing else.

---

## 3. Ministry IDs — LOCKED

IDs appear in URLs, feed filenames, and QR codes people will have saved. They are
permanent. Display names can change freely.

| ID | Display name | Visibility | Phase |
|---|---|---|---|
| `church` | Church-wide | public | 1 |
| `youth` | Greater Generation | public | 1 |
| `youth-leaders` | Youth Leaders | **private** | 1 |
| `children` | Children | public | 2 |
| `youngadults` | Ignite Young Adults | public | 2 |
| `seniors` | Best Life | public | 2 |
| `mens` | Man Church | public | 2 |
| `womens` | Soul Sisters | public | 2 |
| `worship` | Worship / Music | **private** | 2 |

Keep IDs functional, never branded. "Man Church" may be renamed; `mens` won't be.

**Private** means: not in `events.json`, not in any public or bundle feed, only
included in the personal feeds of people whose Sheet row marks them as members.

**Note:** `youth-leaders` is private but NOT sensitive. It holds meeting planning,
not minors' personal information. Kids' birthdays and ball games stay in the
church's existing system for now — do not build for them.

---

## 4. Repo structure

```
/site
  index.html            calendar page (provided — see section 9)
  admin.html            event add/edit form
  signup.html           pick your groups → get personal feed link + QR
  prefs.html            change groups later (token in URL)
/job
  src/
    fetch.ts            Google Calendar API → normalized events
    classify.ts         inference + prefix overrides
    publish.ts          events.json, bundle feeds, personal feeds
    remind.ts           reminder ladder → GroupMe
    sheet.ts            Sheets API read/write
  config/ministries.json
/public                 job output, served by GitHub Pages
  events.json
  feeds/*.ics
  f/<token>.ics
  state.json            reminder dedupe
/.github/workflows/
  sync.yml              hourly cron
```

---

## 5. Event classification — inference first

**Critical design constraint:** leaders will NOT remember to type metadata. Anyone
adding an event at 9pm on their phone types a title and a time and moves on. The
system must work correctly with zero special syntax.

**Inference (default path, no user effort):**
- Title matches `/\b(due|deadline|deposit|forms?|rsvp|sign[- ]?up|last day|turn in|money)\b/i` → `type: deadline`
- All-day event spanning 2+ days → `type: trip`, auto-pinned
- `trip` or `deadline` starting more than 60 days out → auto-pinned
- Everything else → `type: event`, **including recurring events**

**Recurrence does NOT imply `routine`.** The original rule demoted anything
weekly to `routine`. That assumed these calendars carry the normal Sunday and
Thursday rhythm, and they do not: only things people need to pay attention to
go on them. A weekly series here is a four-night revival or a six-week class,
so it needs pinning and reminders like anything else. Demoting it would have
taken a tag to undo, which is the one thing this classifier exists to avoid.

`routine` still exists for a genuine standing fixture, but it has to be asked
for, with a `ROUTINE:` prefix or the admin form.

**Prefix overrides (for when inference guesses wrong):**
- `DUE:` at start of title → force deadline
- `PIN:` → force pinned
- `NOPIN:` → force unpinned
- Strip the prefix before display

**The admin form** sets these explicitly via dropdowns, writing structured values
into the event's extended properties. Both paths must produce identical results.

Optional description fields, parsed if present, never required:
`cost:`, `link:`, `contact:`

---

## 6. Reminder engine

Ladder, configurable per ministry, defaults:
- `deadline`: 30d, 7d, 1d, day-of
- `trip`: 30d, 7d, 1d
- `event`: 7d, 1d
- `routine`: none

**Recurring series are throttled, not silenced.** A daily, weekly or biweekly
series gets the full ladder for its first upcoming occurrence, then day-before
only for each occurrence after that. Otherwise a six-week Wednesday class sends
twelve messages, and its 7-day notice always lands the day after the previous
week's session. A monthly or rarer series is not throttled and takes the full
ladder every time. Configured as `recurringSeries.frequentFollowUp`.

Weekly digest: Sunday 7pm local, "here's the week ahead."

**Dedupe is mandatory.** Key on `${eventUid}:${ruleId}` in `state.json`, committed
back to the repo each run. The job runs hourly; without dedupe it sends 24x.

**Timezone: America/New_York.** GitHub Actions cron is UTC. Since March 2026 there's
an optional per-schedule `timezone:` field — use it. Otherwise run hourly and let
the job decide whether the local hour matches.

**Phase 1 channel: youth parents GroupMe only.** One bot. No other GroupMe groups
exist yet. Build the fan-out to be config-driven so adding a group later is a
config entry plus a secret, but don't build channels nobody uses.

GroupMe posting:
```
POST https://api.groupme.com/v3/bots/post
{"bot_id": "...", "text": "..."}
```
No auth header. Bot IDs are secrets — GitHub Actions secrets, never in the repo.

**Dry-run mode is required.** `DRY_RUN=true` logs what would be sent without
sending. Point at a private test group before the real parents group.

---

## 7. Google Sheet schema

Single spreadsheet, three tabs.

**`People`** — one row per person, one column per group:

| name | email | token | created | church | youth | youth-leaders | … |
|---|---|---|---|---|---|---|---|
| Jane Doe | jane@… | 7d3a9c21 | 2026-09-04 | x | x | | |

- `token` is random, unguessable, generated at signup. It's the personal feed URL.
- An `x` (any non-empty value) means subscribed.
- Public groups: user self-selects at signup.
- Private groups: **only a leader may set these.** The signup page must never let
  someone add themselves to a private group.
- Removing the `x` drops that content from their next feed refresh. That's the
  revocation mechanism.

**`Groups`** — config mirror: id, display name, public/private, color, reminder
overrides, notify channel.

**`Log`** — job writes run timestamp, events processed, reminders sent, errors.

Protected ranges: each private group's column granted to that ministry lead only.

---

## 8. Phase 1 scope — target 1.5 days

Build, in this order:

1. **Job core** — Google Calendar API fetch for `church`, `youth`, `youth-leaders`;
   classify; write `events.json` + bundle feeds.
2. **Public site page** at `/calendar` reading `events.json`. Starting HTML provided.
3. **GitHub Actions hourly workflow**, publishing to GitHub Pages on the subdomain.
4. **Reminder engine** → youth parents GroupMe. Dry-run first.
5. **Signup page** — pick public groups, write row, generate token, show the personal
   feed URL plus QR and add-to-calendar buttons.
6. **Personal feed generation** — per-token `.ics`. Same generator as bundle feeds
   with a membership filter.
7. **Prefs page** — same as signup, prefilled by token, for changing groups later.
8. **Admin form** — add/edit events with real dropdowns, writing to Google Calendar
   via service account.
9. **TV mode** — `/calendar?display=tv`: large type, no interaction, auto-refresh
   every 15 min. For wall-mounted tablets replacing paper calendar cards.

**Deferred to phase 2:** remaining six ministries, per-ministry GroupMe channels,
richer admin permissions, mirroring anything into other systems.

**Explicitly out of scope:** a native mobile app. Nothing about a custom app beats
what people already have. Add-to-home-screen covers this.

---

## 9. Starting site HTML

A working calendar page already exists and should be the starting point — don't
rebuild it from scratch. It has: ministry filter pills, agenda view scoped to
current + next month, pinned section for far-out items, month grid, deadline
countdown treatment, subscribe buttons wired to the filter selection, and
`?ministry=youth` deep-linking. It falls back to embedded sample data if
`events.json` is unreachable, so the page never goes blank.

It needs: TV mode, add-to-home-screen prompt, and wiring to the real feed URLs.

---

## 10. Gotchas already discovered — don't rediscover these

- **`.ics` feeds have no authentication.** A "secret" Google URL is just an
  unguessable link, unrevocable per person. This is why personal feeds are
  generated with rotatable tokens, and why genuinely sensitive data must not go in
  any feed.
- **iOS shared-calendar sync:** if a leader uses Apple Calendar with a Google
  account attached, secondary/shared Google calendars don't sync by default. They
  must visit `calendar.google.com/calendar/syncselect` *on that device*. Put this
  in the onboarding note.
- **Subscribed calendars refresh on the device's schedule**, not ours — iOS
  especially can lag hours. Never rely on a feed for time-critical changes.
  Announce changes in GroupMe.
- **GitHub Actions scheduled workflows** get auto-disabled after 60 days of repo
  inactivity. The job's own commits reset this, so it's handled — but don't remove
  the commit step.
- **GitHub Pages is free for public repos only.** Calendar data is public anyway
  and secrets live in Actions secrets. If the church wants a private repo,
  Cloudflare Pages serves those free.
- **Recurring events:** copy the recurrence rule, never expand to individual
  instances.
- **Silent failure is the main operational risk.** If the job dies, feeds quietly
  go stale and nobody notices. Post failures somewhere a human sees them.

---

## 11. Ownership / succession — non-negotiable

Everything registers to a **church-controlled** identity, never a personal account.
A generic church Gmail already exists and will be used.

- 2FA on, recovery codes in the church safe, recovery email church-controlled
- A second admin (pastor/deacon) on the Google account, GitHub org, and Sheet
- Calendar IDs are permanently tied to the creating account — get this right before
  creating a single calendar
- Domain registrar account under church control, church card, auto-renew on

**Before any code:** confirm login to the church Gmail works. If the recovery phone
is stale, fixing it can take days and blocks everything.

---

## 12. Secrets needed

| Secret | Where from |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP console; grant it edit rights on each calendar and the Sheet |
| `SHEET_ID` | Sheet URL |
| `GROUPME_BOT_YOUTH_PARENTS` | dev.groupme.com/bots (must be a member of the group) |
| `ADMIN_PASSCODE` | Chosen; gates the admin form in phase 1 |

Phase 1 gates the admin form behind an unguessable URL plus a passcode. Proper
Google sign-in checked against the Sheet is a phase 2 upgrade — note the tradeoff,
don't silently ship it as if it were real auth.

---

## 13. How to work

Start with the job and a real calendar with real events. Get `events.json` correct
before touching any UI. Verify classification against actual titles Spencer's
leaders would type — not idealized ones.

Reminders go last and go to a test group first. A bug that spams thirty parents at
6am is the one failure that kills adoption permanently.
