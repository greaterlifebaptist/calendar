# Setup

Everything here registers to the **church-controlled Google account**, never a
personal one. Calendar IDs and project ownership are permanently tied to the
account that creates them.

---

## 1. Service account

The church Gmail is a human account. It signs in with a password and a second
factor. A job running unattended on GitHub's servers at three in the morning
cannot do that, and storing a human password anywhere is not an option.

A service account is a robot identity that lives inside the church's own Google
Cloud project. It authenticates with a key file instead of a password. The
calendars stay owned by the church Gmail. The robot is simply shared onto them,
the same way a person would be.

Signed in as the church Gmail:

1. <https://console.cloud.google.com> — create a project, `GLBC Calendar`.
2. APIs & Services > Library. Enable **Google Calendar API** and **Google
   Sheets API**.
3. IAM & Admin > Service Accounts > Create service account.
   Name it `glbc-calendar-job`. No roles are needed at the project level.
4. Open it, go to **Keys**, Add key > Create new key > **JSON**. A file
   downloads. This is the credential.
5. Copy the service account's email. It looks like
   `glbc-calendar-job@glbc-calendar.iam.gserviceaccount.com`.

The JSON key file is a password. Never commit it, never email it, never paste
it into a chat. It goes in one place: the GitHub Actions secret
`GOOGLE_SERVICE_ACCOUNT_JSON`.

## 2. Share each calendar with the robot

For all three calendars: Settings > **Share with specific people or groups** >
Add people > paste the service account email.

Set permission to **Make changes to events**, not "See all event details". Read
access is enough today, but the admin form writes events back to Google, and
setting it now avoids doing this twice.

## 3. Calendar settings

| Setting | church | youth | youth-leaders |
|---|---|---|---|
| Make available to public | fine either way | fine either way | **turn off** |
| Auto-accept invitations | **do not show invitations** | **do not show invitations** | **do not show invitations** |
| Event notifications | none | none | none |

**Public access on `youth-leaders`.** With it on, anyone who has the calendar ID
can subscribe to the raw calendar directly, and no amount of filtering on our
side changes that. The system treats this calendar as private and keeps it out
of the website and every bundle feed. Leaving it public in Google contradicts
that. Turn it off.

On `church` and `youth` it makes no difference to us either way, since we read
through the API. Leaving them public is harmless.

**Auto-accept invitations.** Every secondary calendar has its own email address.
With auto-accept on, anyone who discovers that address can send an invitation
and have it silently land on the calendar, from which the job would publish it
straight to the church website. Set these to "do not show invitations".

**Notifications.** Turn them off. Google's notifications go to whoever is
subscribed to the raw calendar, which is nobody by design. Reminders are the
job's responsibility and go out over GroupMe on the ladder in CLAUDE.md
section 6. Two systems sending reminders is worse than one.

## 4. What to hand over, and what never to send

| | |
|---|---|
| Needed | Calendar ID, per calendar |
| Needed | The service account JSON key, as a GitHub secret |
| Not needed | Public URL, share link, embed code, public iCal address |
| **Never send** | The **secret iCal address** |

The secret address is a bearer credential. Anyone holding it reads the calendar
forever, it cannot be revoked for one person, and rotating it breaks everyone.
This is the whole reason the system generates its own per-person feeds with
rotatable tokens. Do not paste it anywhere.

## 5. GitHub

The repo must be owned by an account or organisation the church controls, with
a second admin, matching CLAUDE.md section 11.

1. Create the repository and push this code.
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions, add:

   | Secret | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole JSON key file, pasted |
   | `CAL_CHURCH` | the church calendar ID |
   | `CAL_YOUTH` | the youth calendar ID |
   | `CAL_YOUTH_LEADERS` | the youth leaders calendar ID |

   `SHEET_ID`, `GROUPME_BOT_YOUTH_PARENTS` and `ADMIN_PASSCODE` come later.

4. Actions tab > Calendar sync > Run workflow, to test before the hour.

## 6. DNS

The site is served at `calendars.greaterlifebaptistchurch.com`. The main
website stays exactly where it is on SiteGround. The WordPress page at
`greaterlifebaptistchurch.com/calendar` fetches from the subdomain.

Add one DNS record wherever the domain's DNS is managed, which is either the
registrar or SiteGround:

```
Type   CNAME
Host   calendars
Value  <github-owner>.github.io
TTL    default
```

Then in the repo, Settings > Pages > Custom domain, enter
`calendars.greaterlifebaptistchurch.com` and tick Enforce HTTPS once the
certificate is issued. `site/CNAME` already carries this name.

The subdomain is deliberate indirection. If hosting ever moves to Cloudflare
Pages or Azure, it is this one DNS record that changes and nothing else. No
WordPress edits, no re-issued QR codes.

## 7. Decision still open: repo visibility

GitHub Pages is free only for public repositories. That is fine for calendar
data, which is public anyway, and secrets live in Actions secrets rather than
in the repo.

It stops being fine at step 6 of the plan, personal feeds. Those are committed
to `public/f/<token>.ics`, and a person's feed contains every group they belong
to, including private ones. The token makes the URL unguessable, but in a
**public repo the file is browsable regardless of the token**.

Two ways forward:

- **Public repo.** Accept that `youth-leaders` content is readable by anyone who
  browses the repo. Reasonable if it stays what CLAUDE.md says it is: meeting
  planning, not personal information.
- **Private repo on Cloudflare Pages.** Free, serves private repos, same static
  output, same DNS indirection. Slightly more setup.

This only needs deciding before step 6. Steps 1 through 5 are identical either
way.
