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

It also fills in what it reasonably can. The type is guessed from the title as
you type, the same way the job would, and it stops guessing the moment you
choose for yourself. The end date follows the start, and the end time lands an
hour later, until you set either yourself. Times are offered in quarter hours
rather than as a free-typed field, so they are the same on every phone.

Each calendar can suggest a **contact**, filled in automatically when you pick
that calendar. Set them in `job/config/ministries.json`, the `contact` field on
each ministry. Leave it blank for none.

So the common case is: type a title, pick a date, save.

## Turning it on

Three steps, and the middle one is the easy one to miss.

**1. Redeploy the script.** The admin actions live in the same Apps Script as
signup. Paste in the current `site/apps-script/Code.gs`, then Deploy > Manage
deployments > pencil > Version: **New version** > Deploy.

**2. Declare and authorise the calendar permission.**

Apps Script normally works out for itself which permissions a script needs, by
reading the code. That inference is not reliable here, and when it comes up
short the symptom is a save failing with:

> Calendar API 403: Request had insufficient authentication scopes.

The fix is to stop relying on the guess and state the permissions outright.

  1. In the Apps Script editor: **Project Settings**, then tick
     **Show "appsscript.json" manifest file in editor**.
  2. Go back to the **Editor**. `appsscript.json` is now in the file list.
  3. Replace its contents with
     [`site/apps-script/appsscript.json`](../site/apps-script/appsscript.json)
     from this repo, and save.
  4. Pick **`authorizeCalendar`** from the function dropdown at the top and
     press **Run**. Not `doGet`: `doGet` never touches `CalendarApp`, so Apps
     Script can decide the calendar permission is unnecessary and skip the
     prompt entirely. `authorizeCalendar` exists only to make that impossible.
  5. Approve the consent screen. It will mention seeing and editing your
     calendars, which is the point.
  6. Read the execution log. `Calendar REST check: HTTP 200` means it worked.
  7. Redeploy: **Deploy** > **Manage deployments** > pencil > **New version**.

  The manifest also pins "execute as me" and "anyone can access", so those
  cannot drift on a later deploy.

### If it still says no consent was needed

Two things to check, in order.

**Did the manifest actually save?** Open `appsscript.json` in the editor and
confirm it contains an `oauthScopes` list with the calendar entry in it. Apps
Script will quietly keep the old file if the JSON was malformed.

**Force a fresh consent by revoking the old one.** Once a script is authorised,
Google will not ask again unless what it needs has changed, and that comparison
sometimes goes stale.

  1. Go to <https://myaccount.google.com/permissions>, signed in as the church
     account.
  2. Find the script project, likely listed as **GLBC Signup**.
  3. **Remove access**.
  4. Back in the editor, run `authorizeCalendar` again. The consent screen will
     now definitely appear, listing every permission from the manifest.
  5. Redeploy a new version.

Revoking is safe. It removes an authorisation, not the script, and the next run
grants it back. The hourly job is unaffected: it uses the service account, which
is a completely separate credential.

**3. Set the passcode.** This is what `adminReady: false` means, and nothing
else. It is not a GitHub secret and not in the repo; it lives in the script.

  1. Open the Apps Script editor.
  2. Left sidebar, the **gear icon**, **Project Settings**.
  3. Scroll to the bottom, to **Script Properties**.
  4. **Add script property**.
  5. Property `ADMIN_PASSCODE`, value your passcode, then **Save script
     properties**.

  Pick something long that is not used anywhere else. Two or three people will
  share it, and it currently grants every private calendar.

  **No redeploy needed.** Script properties are read at run time, so reload the
  `/exec` URL and `adminReady` flips to `true` straight away. If it does not,
  the property name is misspelled; it is case sensitive.




### Checking

Open the `/exec` URL. You want `version` 7 or higher, with `adminReady`,
`sheet` and `calendar` all `true`:

```json
{"ok":true,"service":"glbc-signup","version":7,
 "actions":["signup","load","save","rotate","admin.hello","admin.list",
  "admin.save","admin.delete","admin.people","admin.setgroups"],
 "sheet":true,"adminReady":true,"calendar":true,"detail":""}
```

`adminReady: false` means the passcode has not been set, and every admin action
will refuse until it is.

`calendar: false` means step 2 has not taken, and saving an event will fail
with a 403. It is checked here so that shows up now rather than the first time
somebody tries to add something.

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

Practical measures already in place: the comparison does not leak how much of
the passcode was right, a wrong one costs the guesser a deliberate delay, ten
wrong ones lock the admin actions for fifteen minutes, and the passcode is held
in the browser tab only until it is closed.

The lockout matters more than it looks. The admin page is linked from the
public calendar, so this endpoint will be poked at. Without a cap, a bot
hammering wrong passcodes would burn the script's daily execution quota and
take signup down for everybody. The counter is script wide, because Apps Script
cannot see who is calling, so an attacker can lock the admins out for fifteen
minutes. That is a far better outcome, and signup and preferences are untouched
either way: nothing but the admin actions ever checks a passcode.

## Who gets which calendars

The second tab lists everybody who has signed up and which calendars they
receive. Public ones they chose themselves; the private ones, shown with a
dashed outline, can only be granted here.

Tapping a chip saves immediately. If the save fails the chip goes back to
where it was and says why, because a chip that looks granted but is not is
the worst possible outcome when the thing being granted is a private calendar.

Changes land on the person's existing link at the next sync. Their link never
changes, so there is nothing for them to redo on their phone.

This is the simplification we chose deliberately: **one passcode grants every
private calendar**. Whoever can add somebody to Youth Leaders can also add
them to Worship. That is fine while two or three trusted people hold it, and
it is the thing to revisit before a pastor's calendar exists.

The sheet remains the backstop. Protected ranges on the private columns still
control who can edit them directly, and are worth setting regardless.

## Things it deliberately will not do

- **Edit one occurrence of a repeating event.** The list shows a series once,
  and editing changes the whole series. Changing a single Sunday is a job for
  Google Calendar, which does it well.
- **Delete quietly.** Deletion asks first and says it cannot be undone from
  here. Google Calendar's trash is the safety net, plus the nightly snapshot in
  [BACKUP.md](BACKUP.md).
- **Invite anybody.** No attendees, no email. Nothing in this system sends mail.
- **Delete a person.** Removing somebody entirely is still a sheet edit, on
  purpose: it destroys their link, and that should take more than a stray tap.

## Later

Tying admin access to a Google sign-in from the church account, as above, is
the natural next step and the one worth doing before the calendars get more
sensitive. A shared sheet of allowed emails would work as the list, and would
sit next to the membership sheet that already exists.
