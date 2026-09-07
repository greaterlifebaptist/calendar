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

Both are created automatically the first time they are needed, with their
headers. Nothing to set up by hand.

**`Contacts`** — the small list the dropdown reads.

| name | email | active |
|---|---|---|
| Spencer Welch | spencer@… | |
| JC Cross | jc@… | |
| Buddy Thompson | | no |

- A blank `active` means yes. You should have to tick a box to switch somebody
  **off**, not to make a new row work.
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
first, with a running total. Past events drop off — nobody is counting for a
Sunday that has been and gone.

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

`job/config/ministries.json` still carries a suggested contact per ministry,
which the form pre-selects. Those need to match a row in `Contacts` to be
useful — and one of them, "Andrea Hutchins or Michelle Jenson", is two people.
Pick one as the ministry default and add both to `Contacts`; an event can only
send to one person.
