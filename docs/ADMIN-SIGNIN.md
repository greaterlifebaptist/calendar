# Signing in to the admin page

`/admin` used to be guarded by one passcode shared between everybody. It now
accepts a Google sign-in checked against a **Leaders** tab in the sheet, and the
passcode keeps working alongside it until it is switched off deliberately.

## Why this rather than more passcodes

A shared secret has three problems that no amount of care fixes. It gets texted
around and ends up somewhere it should not be. Nothing it does carries a name,
so a surprise on the calendar has no author. And taking it away from one person
means changing it for everybody, which is the thing nobody ever actually does.

A sign-in fixes all three at once. There is nothing to pass around, every action
carries the name of whoever did it, and removing somebody is deleting a row —
that person and nobody else, effective immediately.

The one thing it costs is that a leader has to have a Google account and be
willing to sign in with it. Everyone shared a private church calendar already
does, because a Google account is what Calendar shares to.

## What happens when somebody signs in

1. The page asks Google to sign them in and gets back an **ID token**: a short-
   lived, Google-signed statement of who they are and which application they
   signed in to.
2. Every request to the endpoint carries that token instead of a passcode.
3. The endpoint hands it back to Google to be checked, then looks the address up
   in the Leaders tab.
4. On the list: through, and the action is written to the **Admin log** tab under
   their name. Not on it: refused, and the refusal is logged too.

The token lasts about an hour. When it runs out, the page puts the sign-in
button back rather than showing an error — signing in again carries on where
they left off.

### The check that matters

The endpoint verifies that the token was minted **for this application**, not
merely that Google issued it. Without that check, any website could collect a
perfectly valid Google token from its own visitors and replay it here. It is one
line in `verifyIdToken_` and a test asserts it is still there.

## Setting it up

All of this is done once, on the church Google account.

### 1. Make an OAuth client

This lives in the **Google Auth Platform** section of the Google Cloud console.
Any project will do — nothing ties sign-in to the project holding the calendar
service account — but it must belong to the **church** Google account, for the
same reason as everything else here.

Branding has to be filled in before a client can be created, which is why the
console sends you there first.

**Branding**

| Field | Value |
|---|---|
| App name | Greater Life Baptist Church Calendar — leaders see this on the sign-in screen |
| User support email | the church address |
| App logo | **leave empty** |
| App home page, Privacy policy, Terms of service | leave empty |
| Authorized domains | leave empty |
| Developer contact information | the church address |

Two of those are deliberate rather than lazy.

**No logo.** Uploading one sends the app into brand verification, which takes
weeks and changes nothing about how sign-in works. The app name shows either way.

**No app domain links.** Fill any one of them in and an Authorized domain
becomes required, which the console may want proved through Search Console.
That buys nothing here.

**Audience**

The user type will be External; Internal only exists on Workspace accounts.
Press **Publish app**.

Publishing matters more than it sounds. Left in Testing, only addresses added by
hand can sign in — a second list to keep in step with the Leaders tab, whose
failure mode is a leader refused for a reason invisible from inside this system.
There is nothing to wait for: verification is triggered by *sensitive* scopes,
and sign-in asks only for name, email and profile, which are not sensitive.
Leaders see no "unverified app" warning either, for the same reason.

**Data access**

Nothing. Do not add scopes; the sign-in button asks for the three it needs.

**Clients → Create client**

- Application type: **Web application**
- Name: Admin client
- **Authorised JavaScript origins**:
  - `https://calendars.greaterlifebaptistchurch.com`
  - `http://localhost:4173` (only for testing from a computer; harmless to omit)
- **Authorised redirect URIs**: none. The button hands the token to the page;
  nothing redirects.

The origin must match exactly — `https`, no trailing slash, no path. A mismatch
does not report itself: the button simply never appears.

Copy the client ID. It ends in `.apps.googleusercontent.com`. It is not a
secret — it ships in the page — but it is what ties a token to this church.

### 2. Tell the endpoint

Apps Script → Project Settings → Script Properties:

| Property | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the client ID from step 1 |

Deploy `Code.gs` (version `2026-09-09f` or later). Open the `/exec` URL and check
the `signIn` block:

```json
"signIn": { "clientId": true, "required": false, "leaders": 0 }
```

`clientId: false` means the property did not save or the deploy did not take.

Changes to the authorised origins can take a few minutes to reach Google. A
button that has not appeared yet is worth blaming on that before the code.

### 3. Put yourself on the list

Open `/admin`, use the passcode one more time, and go to the **Leaders** tab.
Add yourself with the address you sign in to Google with. Then sign out and sign
back in with Google to prove it works before anybody else depends on it.

Add the other leaders the same way. Anybody on the list can add anybody else,
and the log records who did.

### 4. Turn the passcode off

Once every leader has signed in successfully at least once, add:

| Property | Value |
|---|---|
| `REQUIRE_SIGNIN` | `yes` |

The passcode stops being accepted from that moment. No redeploy is needed and
the page notices on its next load.

**Do this last and not before.** Until it is set, somebody who cannot get their
sign-in to work still has a way in; after it, they do not.

## If everybody is locked out

Set `REQUIRE_SIGNIN` to `no` in Script Properties. The passcode works again
immediately. That property is reachable from a phone, in the Apps Script editor,
which is why the escape hatch lives there rather than in the code.

The endpoint also refuses to remove the last leader, so the list cannot be
emptied by accident from the page.

## Levels

Everybody on the list gets in. What they find once they are in depends on the
**role** column.

| Level | Events | Who gets what | RSVPs | Notices & card | Leaders |
|---|---|---|---|---|---|
| `admin` | yes | yes | yes | yes | yes |
| `staff` | yes | yes | yes | yes | — |
| `leader` | yes | — | yes | — | — |
| `viewer` | — | — | yes | — | — |

A blank role means `leader`, and so does a misspelled one. That is deliberately
the quiet end of the scale: a row typed in a hurry should grant the least
rather than the most. Rows that existed before levels did were filled in as
`admin` when the columns were added, because demoting them silently would have
put the only way back behind a page they could no longer open.

Note what `staff` includes: **who gets which calendars**. A staff member can
put somebody into Youth Leaders or Worship. That is the right line for office
or pastoral staff and the wrong one for a ministry volunteer — the difference
between `staff` and `leader` is mostly this.

The page hides the tabs a level cannot use. That is courtesy, not security: the
endpoint refuses the action either way, and it is the only side that can. A
browser can be edited by whoever is holding it.

**The list can never run out of admins.** The last one cannot be demoted or
removed, because nobody else could put one back.

### Which calendars

The **ministries** column limits somebody to particular calendars. Blank — or a
bare `*` — means all of them, including any added later, which is what stops a
new ministry being invisible to everybody until each row is revisited.

Otherwise it is a list of ministry ids: `youth, youth-leaders`. Ids, not
display names: "Man Church" may be renamed one day, `mens` will not. A scoped
person sees only those calendars in the event dropdown, and only those
ministries' RSVPs — a headcount carries names and phone numbers, and another
ministry's is none of their business.

Two things a scope deliberately cannot do. It cannot remove somebody from the
church list outright, since that takes away calendars the scoped person cannot
see. And when a scoped staff member saves somebody's calendars, only the ones
they cover are changed; the rest are left exactly as they were, rather than
being cleared because the page never drew them.

A scope naming a calendar that does not exist is refused when it is entered.
Accepting it would scope somebody to nothing, and they would sign in to an
empty dropdown with no way to tell why.

**The passcode has no level**, because it has no name. While `REQUIRE_SIGNIN`
is off, anybody using it is an admin over every calendar. One more reason to
turn it off.

## The Admin log tab

One row per action that changes something: when, who — with their level, since
two refusals that differ only by level would otherwise read identically — what,
and enough detail to recognise it. Reads are not logged — the event list is re-read every time
somebody switches ministry, and a log nobody can skim is a log nobody reads.

A row means somebody asked for it, not that it worked; the log is written at the
gate, before the action runs. An attempt that was allowed and then failed
validation is still worth seeing.

It keeps the last 2000 rows and trims from the top.

## What this does not fix

**A level is not per-calendar for the private ones.** Anybody who reaches "who
gets what" and is not scoped can grant Youth Leaders and Worship alike. Scoping
them fixes it; leaving the column blank does not.

**It is not succession.** A second person who can sign in to the admin page is
not a second owner of the Google account, the GitHub repository or the sheet.
That is a separate job and a bigger one.
