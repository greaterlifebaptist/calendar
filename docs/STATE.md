# Where this actually is

A living snapshot. The *reasoning* behind every decision lives in the other
docs and in the commit messages; this is the part that goes stale — what is
running, what is not, and what was being talked about.

Last checked against the live system: **9 September 2026**.

## The four moving parts

| Piece | Where | Ships by |
|---|---|---|
| Hourly job | GitHub Actions, `sync.yml` | push to `job/**` or `site/**`, or hourly cron |
| Website | GitHub Pages, `calendars.greaterlifebaptistchurch.com` | the same sync run |
| Merge service | Cloudflare Worker, `calendar.greaterlifebaptist.workers.dev` | push to `worker/**` |
| Endpoint | Apps Script web app, deployed by hand | **paste and redeploy manually** |

The endpoint is the only piece that does not ship itself. Its version marker is
a **datestamp** (`2026-09-09e` as of writing) — deliberately not Google's
deployment number, which drifted four times before this. Compare the marker in
`Code.gs` against what the `/exec` URL reports; if they differ the deploy did
not take.

## Verified live

- Endpoint `2026-09-09e` — sheet ✓, calendar ✓, admin ✓, 21 actions
- Worker — `ok 7 ministries, colour #1B5E45`
- Site — publishing, 44 events
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

## Not done

**In rough order of how much it matters.**

1. **Reminders still point at a test GroupMe group.** This is the thing the
   whole system was built for — the brief's "primary user need" — and no parent
   has received one. Switching `GROUPME_BOT_YOUTH_PARENTS` to the real group is
   a one-line secret change; being ready for thirty parents to start getting
   messages is the actual decision.

2. **Succession.** The brief calls this non-negotiable and it has not happened:
   a second admin on the Google account, the GitHub org and the sheet, recovery
   codes somewhere the church controls. Right now one person can be hit by a bus
   and the church loses its calendar, its member list, and the ability to fix
   any of it. This is a larger risk than any security item.

3. **Nothing has been used by a real member.** Every flow has been tested by us,
   against mocks or knowing what we meant. Nobody has scanned the code cold,
   signed up in a foyer, or tapped an add-calendar link. Two or three families
   through the whole thing before announcing.

4. **Better security than one shared passcode.** See below.

5. **The card has never been printed.** Type size, QR scannability and the safe
   margins are unverified on paper.

6. **No Pi yet** for the fellowship hall TV. A laptop will do meanwhile.

Deliberately dropped: protected ranges on the sheet (nobody else opens it), and
the brief's `Log` tab (the Actions run summary replaced it).

## The open conversation

**Replacing the admin passcode with Google Sign-In**, checked against a leaders
list in the sheet. Recommended over more passwords because the church already
runs on Google and the leaders already have accounts — they are being shared
private calendars through them. It buys real identity, revocation by deleting a
row, and nothing to leak. Roughly half a day: an OAuth client, a sign-in button,
token verification in Apps Script, and a `Leaders` tab.

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
