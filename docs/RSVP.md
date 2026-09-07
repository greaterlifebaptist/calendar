# RSVPs

An event names somebody to respond to. People say they are coming and how
many, and that person gets a headcount.

## Two rules that shape all of it

**Email addresses never reach a browser.** The dropdown gets names; an RSVP
carries an event id. The address is looked up on the server at the moment of
sending. Otherwise every leader's address would sit on a public page that also
happens to carry a form, which is how addresses get harvested.

**The contact gets one message a day with the whole list**, not one per reply.
Forty families answering a trip would otherwise be forty emails — and the
church account can send to roughly a hundred recipients a day *in total*, so
one popular event could silently use up the lot.

This is also the only email this system sends anywhere. It was built
deliberately not to send any; that is now one exception, made on purpose.

## Two tabs in the Sheet

**In the Calendar Permissions spreadsheet**, alongside `People` — the same
file the signup page writes to. Not on the website; the website only ever
shows what is in them.

Both are created automatically the first time they are needed, with their
headers. Nothing to set up by hand: deploy the script, and the tabs appear
the first time somebody opens the admin form or sends an RSVP.

The **RSVPs** tab on the admin page is a view of the `RSVPs` sheet, nothing
more. Every response lives in the spreadsheet, where it can be sorted,
filtered, printed or copied into anything else.

**`Contacts`** — the small list the dropdown reads.

| name | email | active |
|---|---|---|
| Spencer Welch | spencer@… | |
| Andrea Hutchins and Michelle Jenson | andrea@… ; michelle@… | |
| Buddy Thompson | | no |

- A blank `active` means yes. You should have to tick a box to switch somebody
  **off**, not to make a new row work.
- **A contact can be more than one person.** Separate the addresses with a
  semicolon or a comma and everyone on that row gets the same message, so they
  can see each other has it and nobody chases the same family twice. A contact
  is a role as often as a person.
- Somebody with no email can still be named on an event; they simply get no
  digest, and the admin dropdown says "(no email on file)".
- **Fix an address here and every future email is right.** The event stores the
  *name*; the address is resolved at send time, so correcting one cell does not
  leave two hundred past events pointing at a dead mailbox.

**`RSVPs`** — one row per response, and it grows.

| when | eventId | starts | event | ministry | name | count | phone | note | contact |
|---|---|---|---|---|---|---|---|---|---|

Answering twice replaces the earlier row rather than adding a second, matched
on event plus name. People change their minds about numbers, and a leader
counting a list should not have to work out which "Jane Doe" is current.

## What people see

Any event that names a contact gets an **I'm coming** button on the calendar
page. It opens a short form: name, how many, and optional phone and note. The
button then reads "You're down for 4".

Events with no contact get no button. One with nowhere to send is worse than
none at all.

## What a leader sees

The **RSVPs** tab on the admin page: every response grouped by event, soonest
first, with a running total.

Events already held are hidden by default and reachable with one tick, newest
first. **Nothing is ever deleted.** "How many came to the fall festival last
year" is a real question a year later, and answering it is most of the reason
this is worth recording at all.

And one email a day, around 7am, but only on days when something changed. It
carries the **whole** list rather than the day's additions, because the
question a leader is holding is "how many am I cooking for", not "who replied
since yesterday". Silence is meaningful: no email means nobody responded and
the last one is still accurate.

## Switching the daily email on

Once, in the Apps Script editor: pick **setupDailyDigest** from the function
dropdown at the top and press **Run**. It creates the daily trigger and says so
in the log. Running it again is safe; it replaces the existing trigger rather
than adding a second.

Until you do, everything else works — responses are recorded and the RSVPs tab
shows them. Only the email is missing.

## Why an RSVP cannot be forged

The endpoint checks the event against the published `events.json` before
recording anything. That file contains public events only, by construction, so
nobody can RSVP to a private meeting, invent an event id, or attach responses
to something that does not exist — and this endpoint needs no idea of what is
private in order to refuse.

There is no login, so there is a cap on how fast responses can arrive, well
above any real Sunday. Names and notes are length-limited.

## Contacts and the ministry defaults

`job/config/ministries.json` carries a suggested contact per ministry, which
the form pre-selects. Each of those names needs a matching row in `Contacts`
to be useful — spelled the same, because that is what the lookup matches on.

"Andrea Hutchins and Michelle Jenson" is one row with two addresses, not two
rows. The names in config were updated to match.
