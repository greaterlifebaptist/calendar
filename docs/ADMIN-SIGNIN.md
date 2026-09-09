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

In the Google Cloud console, in the project that already holds the calendar
service account:

1. **APIs & Services → OAuth consent screen**. External. App name "Greater Life
   Baptist Calendar", support email and developer email both the church address.
2. Scopes: leave it alone. Sign-in needs only name, email and profile, which are
   granted without asking for anything.
3. **Publishing status → Publish app.** Left in Testing, only accounts added by
   hand can sign in and their sessions expire after a week. With only those
   three scopes there is nothing to be verified for, so publishing is instant.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Name it "Admin page".
5. **Authorised JavaScript origins** — the page is refused without these, and
   they must have no trailing slash:
   - `https://calendars.greaterlifebaptistchurch.com`
   - `http://localhost:4173` (only for testing from a computer; harmless to omit)
6. Copy the client ID. It ends in `.apps.googleusercontent.com`. It is not a
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

## The Admin log tab

One row per action that changes something: when, who, what, and enough detail to
recognise it. Reads are not logged — the event list is re-read every time
somebody switches ministry, and a log nobody can skim is a log nobody reads.

A row means somebody asked for it, not that it worked; the log is written at the
gate, before the action runs. An attempt that was allowed and then failed
validation is still worth seeing.

It keeps the last 2000 rows and trims from the top.

## What this does not fix

**Everyone who gets in can do everything.** Adding somebody to Youth Leaders and
adding them to Worship are the same permission. That is fine while the Leaders
tab is a handful of people who between them already have every private calendar,
and it is the thing to revisit before a pastor's calendar exists.

**It is not succession.** A second person who can sign in to the admin page is
not a second owner of the Google account, the GitHub repository or the sheet.
That is a separate job and a bigger one.
