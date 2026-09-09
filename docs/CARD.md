# The printed calendar card

A half sheet, both sides, handed out at church and stuck on a fridge. It is the
one part of this system that reaches people who will never open the website,
and the only part that cannot be corrected after it ships.

Historically the church sent a list of dates to a print company who pasted it
into their template. This produces the finished PDF instead, so the design is
ours and any printer that takes a PDF can print it.

## What it is

| | |
|---|---|
| Trim | 5.5 × 8.5in — half of US Letter, portrait |
| Bleed | 0.125in on every edge |
| Safe margin | 0.25in inside the trim |
| Pages | 2 — front and back |
| Colour | works in colour or black and white from the same file |
| Fonts | Zilla Slab and Public Sans, embedded as subsets |

Those bleed and margin values are what essentially every printer accepts. One
asking for different numbers is a change to four constants at the top of
[`job/src/card.ts`](../job/src/card.ts), not a redesign.

## What goes on it

**The two months after the one it is generated in.** Cards are printed
mid-month for the months ahead, so a run in October produces November and
December. Never the current month: by the time a card is printed and handed
out, half of it has already happened.

**Every public ministry, merged into one date order.** A reader wants to know
what is on the 14th, not which ministry owns it. Private ministries never
appear.

**Every occurrence on its own line.** A recurring series is not collapsed to
"Wednesdays through October" — the whole point of a printed card is the dates,
written down.

**Deadlines in bold with a DUE marker, in place**, and recapped on the back under
**Don't forget**. In place rather than in their own section, because a card is
read by scanning dates and splitting the list means the same month appears
twice in two sequences. The recap is a checklist, not a second timeline.

## What does not

**Routine events.** The regular services and the fortnightly supper would be
forty identical lines across two months, crowding out the things people
actually need telling. They stay on the website and the wall display, where
space is not scarce and the real dates are useful.

The card carries a standing note instead. Edit it on the admin page under
**Notices**, one per line — that is where anything on a regular rhythm belongs,
since marking it `ROUTINE:` is what keeps it off the dated list.

Those notes live in a **Settings** tab in the membership sheet rather than
somewhere only Apps Script can reach, because the job already has authenticated
access to that sheet and none at all to the script. A card built once a month
must not fail on an HTTP call to a web app, and a leader can read or correct the
value directly if the page is ever unavailable. Until somebody sets one, the
default in [`ministries.json`](../job/config/ministries.json) stands:

> Supper served 1st & 3rd Thursday at 5:30, during the school year.

So marking something `ROUTINE:` is what keeps it off the card. That reuses a
concept the classifier already has rather than inventing a print-only flag.

### Black and white

There is no separate mono file, because there does not need to be: a printer
converts the PDF and it still reads correctly.

That took one change. Deadlines were orange, and orange goes **lighter** than
black in greyscale — so on a mono print the urgent lines would have come out
fainter than everything else, the exact opposite of the point. They are bold
black now with a DUE marker, and the colour sits on top of a distinction that
already works without it.

### How it flows

The front is packed first, then it spills onto the back, repeating the month's
heading there so a reader landing on the back is not looking at a list of dates
with no month attached.

Not a month a side: a quiet month would leave a third of the front empty while
the back carried ten lines.

**Notes never begin on the front.** Somebody looking at the card should see
dates there, not ruled lines. If everything fitted on the front then the whole
back is notes, which is the right answer for a quiet month — a card people can
write on.

The QR sits in the same place on both sides. The ruled lines that reach its
band stop short of it rather than the whole block ending early, which would
waste the width of the page for the sake of one corner.

## Titles

The card uses the event's title. A title good enough for the website is
usually good enough for a printed line.

When it is not — too long, or carrying detail that belongs in the description —
the admin form has an optional **Calendar card** field. Set it and the card
uses that instead. Blank, which it will be nearly always, means use the title.

It is deliberately optional. A field leaders must remember is a field that gets
skipped, and the whole classifier exists to avoid depending on that.

## Making one

**Manual, never automatic.** Admin page > **Notices** > **Make the card**.
It builds the PDF, emails it, publishes it, and the site redeploys within a
couple of minutes.

The button is the point. Making a card is a once-a-month job for whoever runs
the church calendar, not a build task — sending somebody into a continuous
integration UI to do it is how a feature quietly stops being used. The Actions
tab still works if it is ever needed.

It needs two script properties, the same pair that makes a new signup link
work immediately:

| Property | Value |
|---|---|
| `GITHUB_REPO` | `greaterlifebaptist/calendar` |
| `GITHUB_DISPATCH_TOKEN` | a fine-grained token with **Contents: read and write** on that repository only |

Pressing it twice is refused for a few minutes. Building a card is not free and
it emails somebody; two people pressing, or one person pressing again because
nothing visibly happened, should not send two cards.

Manual on purpose. A card goes to a printer on the church's schedule, not the
calendar's — somebody may add an event on the 16th, right before it is sent. An
automatic monthly build would also quietly replace a file after it had already
gone to the printer, so the copy on the site would stop matching what people
are holding.

It covers **the two months after the one it is run in**, so a run in September
produces October and November. By the time it is printed and handed out that
reads as "this month and next", and the next run a month later overlaps by one
month, so there is never a gap.

The **First month** input overrides that, as `YYYY-MM`, for making a card early
or remaking one. Anything else is refused rather than guessed at.

A calendar that cannot be read stops the whole run. A card printed with a
ministry silently missing is worse than no card, because it would be handed out
and nobody would know what had been left off.

### Emailing it

Set **Email the card to** on the admin page, under Notices. It picks from the
same Contacts list as the RSVP digest, so there is one place where anybody's
address lives — correct it there and everything that mails them is fixed.

When a card is built it is attached and sent. **When the build fails, that is
sent too**, saying what went wrong. Silence is the worst outcome: somebody
would be waiting on a card that was never coming and would find out when the
printer asked for it.

The bytes travel from the Action to Apps Script in the request rather than
being fetched back off the site, because the site does not have the new card
yet — it is published by the same run and takes a couple of minutes to deploy.
Waiting on that would make sending depend on a deploy, which is the sort of
timing bug that works every time until the one time it matters.

It needs `ADMIN_PASSCODE` as a repository secret. Without it the card is still
built and published and only the email is skipped, which the log says plainly.

### The year rollover

November's run produces December and **January of the next year**, and the
month headings carry the year so a reader can see it. Events are matched on
year and month together, so January 2027 cannot collect January 2026.

That is the case that would otherwise be found in December with cards already
printed, so it has tests rather than an assurance.

## The QR code

[`site/qr-calendar.pdf`](../site/qr-calendar.pdf), embedded as vector so it
stays sharp at any size. It is the church's own branded code, with the logo in
the middle, matching the ones already printed on other church material.

It points at **greaterlifebaptistchurch.com/calendar** — the church's own front
door, not the subdomain. A printed card cannot be reissued if the calendar ever
moves hosts; the apex domain can be repointed.
