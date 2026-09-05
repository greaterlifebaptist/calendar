# Getting the calendar onto a phone

Two routes, because one of them does not work everywhere.

## The problem

**The Google Calendar app on Android cannot add a calendar from a link.**
"Add by URL" exists only on the website. So a subscription link, which is one
tap on an iPhone, cannot be finished at all on an Android phone. Telling
somebody who has just scanned a QR code at church to go home and find a
computer is not a signup flow; it is a way to lose them.

## What we do instead

The church account owns these calendars, so it can share them **directly with a
person's Google account**, which is what their Android phone is already signed
into. On the signup page they type their Google address and the calendars
appear in the app they already have.

| | Subscription link | Shared with your Google account |
|---|---|---|
| iPhone | one tap | works |
| Android | **impossible on the phone** | works |
| Calendars you end up with | one, merged | one per ministry |
| Colours | all one colour | a colour each |
| Revoking | replace the link | remove the access |

Both are offered. The link stays the better answer on iPhone and desktop; the
Google route is the only one that finishes on Android.

## Why not one merged calendar with colours

Because no major calendar app supports it. Colour belongs to a *calendar*, not
an event. The iCalendar standard does have a per-event colour property, and
Google Calendar and Apple Calendar both ignore it in a subscribed feed.

So one merged calendar means one colour, and a colour per ministry means a
calendar per ministry. Choosing the Google route happens to give the colours,
which is a real gain rather than a consolation.

## Name the calendars properly first

A shared calendar shows **its own name in Google**, not the display name from
our config. The calendars are currently named `church`, `youth`, `mens` and so
on, so somebody who accepts a share sees a calendar called "mens".

Rename them in Google Calendar. Settings for each calendar, change the **Name**:

| Calendar id | Name it |
|---|---|
| `church` | GLBC Church-wide |
| `youth` | GLBC Greater Generation |
| `youth-leaders` | GLBC Youth Leaders |
| `children` | GLBC Children |
| `youngadults` | GLBC Ignite Young Adults |
| `seniors` | GLBC Best Life |
| `mens` | GLBC Man Church |
| `womens` | GLBC Soul Sisters |
| `worship` | GLBC Worship |

The `GLBC` prefix groups them together in everybody's calendar list, which is
the closest thing Google offers to a folder.

**Renaming is safe.** A calendar's id never changes, so nothing in this system
notices. Our own pages and feeds keep using the display names in
`job/config/ministries.json`, which are already the friendly ones.

## The invitation email

Sharing normally emails an invitation the person must accept, then asks again
in the calendar. That is two steps between them and a working calendar, so the
share is sent with notifications **off**, which should let it appear directly.

If it still asks for acceptance, that is Google's behaviour for personal
accounts and there is nothing to be done about it from here. It is still all on
the phone, which is the part that matters.

## Changing groups later

The preferences page keeps Google access in step with the ticks. Unticking a
ministry removes the calendar from their account rather than only dropping it
from a feed they may not be using.
