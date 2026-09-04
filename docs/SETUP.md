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
it into a chat. Open it in a text editor, copy the whole contents, and paste
that as the value of one GitHub Actions secret, `GOOGLE_SERVICE_ACCOUNT_JSON`.
Then delete the downloaded file. If it is ever needed again, generate a new key
and delete the old one from the Keys tab.

## 2. Share each calendar with the robot

For all three calendars: Settings > **Share with specific people or groups** >
Add people > paste the service account email.

Set permission to **Make changes and see all event details**.

Not "See event details", which is read-only, and the admin form has to write
events back to Google. Not "Make changes (see private events as free/busy)"
either: that one hides the details of any event marked Private in Google, so
those would reach the website as blank entries. Not "Make changes and manage
sharing", which lets the robot re-share the calendar and is more than it needs.

## 3. Calendar settings

All three calendars get the same settings:

| Setting | Value |
|---|---|
| Make available to public | **off** |
| Auto-accept invitations | **do not show invitations** |
| Event notifications | none |

**Public access off everywhere.** The job reads through the API as the service
account, so public access buys us nothing. Off is better than harmless: it
means the only way to see the calendar is through the church's own system, so
nobody ends up subscribed to a raw Google calendar that we cannot revoke, cannot
filter, and cannot rename without breaking.

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

4. Actions tab > Calendar sync > Run workflow, to test without waiting for the
   hour. The site appears at `https://<owner>.github.io/<repo>/`. DNS can wait.

## 6. DNS

The site is served at `calendars.greaterlifebaptistchurch.com`. The main
website stays exactly where it is on SiteGround. The WordPress page at
`greaterlifebaptistchurch.com/calendar` fetches from the subdomain.

Add one DNS record in SiteGround, under Site Tools > Domain > DNS Zone Editor:

```
Type   CNAME
Host   calendars
Value  <github-owner>.github.io
TTL    default
```

Do this part last. Until the record exists, the site is testable at the
default address GitHub gives you, which is
`https://<owner>.github.io/<repo>/`.

When the record is live:

1. Repo Settings > Secrets and variables > Actions > **Variables** tab. Add a
   variable named `SITE_DOMAIN` with the value
   `calendars.greaterlifebaptistchurch.com`. The workflow only writes the
   CNAME file when that variable is set, so a half-finished DNS change cannot
   take the site offline.
2. Repo Settings > Pages > Custom domain, enter the same name.
3. Tick Enforce HTTPS once the certificate is issued, which can take a few
   minutes.

The subdomain is deliberate indirection. If hosting ever moves to Cloudflare
Pages or Azure, it is this one DNS record that changes and nothing else. No
WordPress edits, no re-issued QR codes.

## 7. Repo visibility

**Public repo, GitHub Pages.** No Cloudflare, no paid plan.

GitHub Pages is free only for public repositories, and a public repo is fine
here: the calendar data is public anyway and every credential lives in Actions
secrets rather than in the code.

The one thing that would have made a public repo wrong is personal token feeds,
at step 6 of the plan. A person's feed contains every group they belong to,
including private ones, so committing those files would put youth leaders
content in front of anyone browsing the repo, token or no token.

They are not committed. `public/f/*.ics` is gitignored. The feeds are rebuilt
from the Sheet on every run and copied straight into the deployed site, which
the workflow assembles as an artifact rather than from committed files. Nothing
private ever enters git history.

What remains true, and always would have been: the deployed feed is reachable by
anyone holding the token URL. That is inherent to a calendar subscription, which
is why tokens are rotatable and why genuinely sensitive information must not go
into any feed. GitHub Pages does not list directory contents, so `/f/` itself
returns nothing.

---

## 8. Where the church's passwords live

Not in this repo, and not in any repo.

A repository is the wrong container for credentials, even a private one:

- Everyone with repo access reads them, and access tends to widen over time.
- Every clone puts a copy on someone's laptop, inside their backups.
- Git keeps history. Deleting a password in a later commit does not remove it,
  and rewriting history breaks every existing clone.
- A repo that later needs to go public, or a fork made by a helper, exposes
  everything at once.

The failure mode is not theoretical. The church Gmail is the account that owns
the calendars, the GitHub account, the app store listing, and the domain
recovery path. Whoever reads that password controls all of it.

Use a password manager with shared access instead. Bitwarden's free plan
includes a two-person organisation, which covers Spencer plus the pastor or a
deacon, and is enough for what is needed here. 1Password Families works equally
well if the church already pays for one.

Per CLAUDE.md section 11, alongside that:

- Two-factor authentication on the church Gmail and the GitHub account.
- Recovery codes printed and kept in the church safe, not in the manager.
- A second admin on the Google account, the GitHub account, and the Sheet.
- Registrar account under church control, church card, auto-renew on.

What may safely live in the repo: calendar IDs, the Sheet ID, ministry config,
and every line of code. What may not: the service account key, GroupMe bot IDs,
the admin passcode, and any account password. Those are GitHub Actions secrets
or password manager entries.
