# Where this actually is

A living snapshot. The *reasoning* behind every decision lives in the other
docs and in the commit messages; this is the part that goes stale — what is
running, what is not, and what was being talked about.

Last checked against the live system: **23 September 2026**.

## The four moving parts

| Piece | Where | Ships by |
|---|---|---|
| Hourly job | GitHub Actions, `sync.yml` | push to `job/**` or `site/**`, or hourly cron |
| Website | GitHub Pages, `calendars.greaterlifebaptistchurch.com` | the same sync run |
| Merge service | Cloudflare Worker, `calendar.greaterlifebaptist.workers.dev` | push to `worker/**` |
| Endpoint | Apps Script web app, deployed by hand | **paste and redeploy manually** |

The endpoint is the only piece that does not ship itself. Its version marker is
a **datestamp** (`2026-09-11a` as of writing) — deliberately not Google's
deployment number, which drifted four times before this. Compare the marker in
`Code.gs` against what the `/exec` URL reports; if they differ the deploy did
not take.

## Verified live

- Endpoint `2026-09-11a` — sheet ✓, calendar ✓, 27 actions
- Sign-in — Google client set, 6 leaders, 2 of them admins, **passcode still
  accepted** (`REQUIRE_SIGNIN` not set)
- RSVP digest — daily trigger present and running
- **Reminders are live to the real youth parents group**, and have been since
  10 September. The first real ones were the 7-day notices for the revival
  nights and the parent meeting.
- Worker — `ok 7 ministries, colour #1B5E45`
- Site — publishing, 55 events; the website, TV and admin pages match the repo
- Ten ministries: `church youth youth-leaders* children children-leaders*
  youngadults seniors mens womens worship*` (`*` private)
- `/calendar` on the church site is public and the embed renders correctly
- Backups pushing to the private snapshot repo
- The hourly run checks itself: merged feeds, the endpoint, and the sheet

## Built and working

The website, filters, month grid, TV display with the wall notice and crawling
rail, personal feeds, combination feeds, Google-account sharing, the admin form,
RSVPs with the daily digest, the printed card, the wall notice, and the contacts
list. Each has a doc.

Added since the first snapshot: Google sign-in for the admin page with four
levels and per-ministry scope, and an Admin log of who did what. The TV looks a
set number of days ahead (35, set from the Notices tab), an event can be kept
off the TV entirely or until a date, and the rail re-decides whether to crawl
whenever its size changes. An RSVP can be changed rather than added to.

In use: the monthly card PDF arrives by email and is right; the TV runs from
Spencer's laptop through the ATEM; `/tv` fits an iPad once the address bar is
swiped away, which is the plan for the other building under Guided Access.

## Not done

**In rough order of how much it matters.**

1. **Real use is still thin.** Reminders are reaching parents and working.
   RSVPs have barely been used, and nobody has yet signed up cold from a QR
   code or tapped an add-calendar link without one of us beside them.

2. **Half the contacts cannot be emailed.** The Contacts tab has 8 people and
   only 4 addresses. An event naming one of the other four still collects
   RSVPs, and nobody ever receives the headcount. Spencer is collecting the
   missing addresses. The health URL reports this as `rsvps.reachable` against
   `rsvps.contacts`, so it can be checked without opening the sheet.

3. **The permanent TV machine.** A Pi was the plan and has been dropped: the
   screen also has to play YouTube, video, audio and slideshows, run by
   volunteers. The likely answer is a refurbished business mini PC on an
   always-on outlet in the ATEM closet, with a small monitor. The open problem
   is Thursdays, when the ATEM must record the service untouched while the TV
   plays youth media — probably an HDMI switch that bypasses the ATEM. That is
   being worked out separately; the Chrome startup settings and a volunteer
   card come back here once it is settled.

4. **The card has never been printed.** The emailed PDF is right; type size,
   QR scannability and the safe margins are unverified on paper.

Deliberately dropped: protected ranges on the sheet (nobody else opens it), and
the brief's `Log` tab (the Actions run summary replaced it).

## Decided

**Succession is handled.** Spencer has passed the account details to somebody
else at the church, so the system no longer has exactly one person who can
reach it. That was the brief's one non-negotiable and the only failure here
that is permanent.

Worth knowing what that does and does not cover, whenever anybody next looks
at it: credentials mean somebody else can get *in*. Two-factor recovery codes
held only on one phone, or being the sole owner of the GitHub repository, would
still be single points of failure. Not urgent, and not a reason to reopen it.

**The passcode stays on, alongside Google sign-in.** Deliberate, as of 23
September. Sign-in works and the six leaders have levels, but `REQUIRE_SIGNIN`
is left unset so the shared passcode is still accepted.

The cost is worth stating plainly so nobody has to rediscover it: the passcode
carries no name and therefore no level, so anybody holding it is an admin over
every calendar, and the levels are advisory against them. Setting
`REQUIRE_SIGNIN` to `yes` closes that whenever the time is right, takes effect
immediately, and `no` brings the passcode back.

**Google sign-in replaces the admin passcode**, checked against a Leaders tab in
the sheet. Chosen over a handful of passcodes because the leaders already have
Google accounts — that is what a private church calendar is shared to — and
because more shared secrets buys none of what matters: a name against each
action, and revoking one person without disturbing anybody else.

The church itself does **not** run on Google; only this calendar system does.
That is why Microsoft was worth considering, and why it was left alone: the
SharePoint account the leaders may end up with does not exist yet, and Apps
Script would have to check a Microsoft token by calling Graph rather than one
tokeninfo endpoint. If those accounts become real, the swap is contained to
`verifyIdToken_`.

The alternative considered and not chosen: several passcodes in a sheet tab.
A real improvement over one, but still shared secrets that get texted around,
for most of the work of doing it properly.

## Things worth not rediscovering

- **The church has no computer.** Everything is done from a phone. This is why
  the card has a button on the admin page rather than living in the Actions tab,
  and why print-from-browser was not good enough for the printer.
- **The endpoint version marker is a datestamp, not a deploy number.** Four
  attempts to keep it in step with Google's counter failed.
- **Ministries in a feed address are separated by `~`, not `-`.** Ids may
  contain a hyphen, and `youth-leaders` does.
- **Nothing on the public pages mentions GroupMe.** It is the youth parents'
  own arrangement and means nothing to most readers.
- **Access and subscription are different things in Google Calendar.** Granting
  somebody a calendar does not put it in their list; only they can do that. Every
  route ends in them tapping a link.
- **A card is generated for the two months *after* the run**, never the current
  one, and the year rollover has tests.
- **`REQUIRE_SIGNIN` is the escape hatch, and it lives in script properties on
  purpose.** Setting it to `no` brings the passcode back from a phone. The
  endpoint also refuses to remove the last leader, so the list cannot be
  emptied into a lockout.
- **The admin page asks the endpoint which doors exist** rather than deciding
  for itself, so turning sign-in on is a script property and not a site deploy.
- **There are two things called "state", and only this one is for people.**
  `job/state/reminders.json` is the ledger of reminders already sent. Never
  edit it by hand: removing a line makes the job send that reminder again.
- **The reminder ledger is keyed by channel, not by bot.** Swapping the GroupMe
  bot secret to a different group resends nothing and loses nothing.
- **Sheets turns date-shaped text into dates.** Anything written like
  `2026-09-18T19:00:00` comes back out of a cell as a Date, so comparing it
  with the text that was written is always false. That is what made every RSVP
  append instead of replace.
- **A tab that is not being painted gets no resize events**, and no
  ResizeObserver callbacks either — both ride on the rendering loop. The
  browser pane used for testing often is not painting, so a resize test there
  can fail when the code is right. A real screen people are looking at paints.
