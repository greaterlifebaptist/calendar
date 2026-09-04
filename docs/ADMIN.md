# Admin form

`/admin` lets a handful of leaders put an event on a church calendar by filling
in a form, instead of navigating Google Calendar.

Google Calendar remains the system of record and always will. This does not
replace it; it writes to it. Anything added here appears in Google Calendar
immediately and on the website at the next hourly sync.

## What it does that Google Calendar cannot

**It sets the type explicitly.** Deadline, trip, routine or event, chosen from
buttons, written into the event's extended properties. That is the highest
precedence path the classifier honours, so nobody has to phrase a title a
particular way or remember a `DUE:` prefix.

**It puts cost, contact and link in the right shape** so they come out as
proper fields on the website rather than as a wall of description text.

**It pins things.** One checkbox instead of a `PIN:` prefix.

**It offers the private calendars too.** Youth Leaders and Worship are in the
dropdown, which the public signup page will never do.

It also guesses the type from the title as you type, the same way the job
would, and stops guessing the moment you choose for yourself. So the common
case is: type a title, pick a date, save.

## Turning it on

Three steps, and the middle one is the easy one to miss.

**1. Redeploy the script.** The admin actions live in the same Apps Script as
signup. Paste in the current `site/apps-script/Code.gs`, then Deploy > Manage
deployments > pencil > Version: **New version** > Deploy.

**2. Authorise the new calendar permission.** The script now writes to
calendars, which is a permission it did not previously hold, and Google will
not grant it silently.

  1. In the Apps Script editor, pick any function from the dropdown at the top,
     for example `doGet`, and press **Run**.
  2. Approve the consent screen when it appears. It will now mention seeing and
     editing your calendars, which is the point.
  3. Redeploy as in step 1 if you had not already.

  Skip this and every save fails with a permission error, even though the
  deployment looks healthy.

**3. Set the passcode.** Project Settings > **Script Properties** > Add script
property:

  | Property | Value |
  |---|---|
  | `ADMIN_PASSCODE` | something long that is not used anywhere else |

  It lives only there. It is never in the repo, never in the page, and never
  sent to the website's host.

### Checking

Open the `/exec` URL. You want `version` 3 or higher and `adminReady: true`:

```json
{"ok":true,"service":"glbc-signup","version":3,
 "actions":["signup","load","save","rotate","admin.hello","admin.list","admin.save","admin.delete"],
 "sheet":true,"adminReady":true,"detail":""}
```

`adminReady: false` means the passcode has not been set, and every admin action
will refuse until it is.

## About that passcode

This is a shared secret, not authentication. CLAUDE.md says so plainly and it
is worth repeating: it tells you that *somebody* who knows the passcode made a
change, never *who*. There is no audit trail beyond Google Calendar's own
history.

That is a reasonable trade for a form that can only add church events, and it
stops being reasonable the moment this form can reach anything genuinely
private. **Before a pastor's calendar exists, this needs real Google sign-in**,
checked against a list of allowed accounts. That is a contained change: the
Apps Script already runs as the church account and can read `Session
.getActiveUser().getEmail()` when deployed to execute as the *user* rather than
as the owner. It is not work to do speculatively, but it is work to do before
the sensitive calendars, not after.

Practical measures already in place: a wrong passcode costs the guesser a
deliberate delay, the comparison does not leak how much of it was right, and
the passcode is held in the browser tab only until it is closed.

## Things it deliberately will not do

- **Edit one occurrence of a repeating event.** The list shows a series once,
  and editing changes the whole series. Changing a single Sunday is a job for
  Google Calendar, which does it well.
- **Delete quietly.** Deletion asks first and says it cannot be undone from
  here. Google Calendar's trash is the safety net, plus the nightly snapshot in
  [BACKUP.md](BACKUP.md).
- **Invite anybody.** No attendees, no email. Nothing in this system sends mail.

## Later

Tying admin access to a Google sign-in from the church account, as above, is
the natural next step and the one worth doing before the calendars get more
sensitive. A shared sheet of allowed emails would work as the list, and would
sit next to the membership sheet that already exists.
