# Backups

## How long it keeps things

**Forever, and that is deliberate.** The working copy in the backup repository
is always one snapshot — the current state of every calendar. The value is in
the git history behind it: every version of every calendar since the day this
started, which is what lets you answer "a leader deleted a recurring series
some time last month, what was in it?"

That history is cheap. The snapshots are small JSON, git stores them as deltas,
and a decade of real changes is a few thousand commits and a few tens of
megabytes. There is no need to prune it, and pruning a backup is the wrong
instinct anyway.

What did need fixing was the noise. Every snapshot file used to carry the time
it was taken, so all ten files differed on every run and the repository took a
commit an hour whether or not a single calendar had changed — 8,760 snapshots a
year, almost all recording nothing but the clock. Disk was never the problem;
legibility was. Finding the week something was deleted is hopeless in a list of
identical hourly commits.

So now:

- Per-calendar files carry **no timestamp**. They change only when the calendar
  does, and a test asserts that two captures of identical data are byte for
  byte the same.
- The capture time lives once, in `manifest.json`.
- The workflow commits only when something under `backup/calendars/` differs.
- If nothing has changed for 30 days it pushes a liveness commit anyway, so
  the repository itself says the backup is still running. Without it, "last
  commit four months ago" reads the same whether nothing changed or the whole
  thing quietly broke.

A year of a normally busy church calendar should be a few hundred commits, each
one an actual change worth looking at.

## What can actually go wrong

Google losing your data is not the risk worth planning for. Calendar is
replicated across regions and a hardware failure will never be why the church
loses a schedule.

These are the real ones, roughly in order of likelihood:

| Risk | Google's own safety net |
|---|---|
| A leader deletes a recurring series or a batch of events | Per-calendar Trash, 30 days |
| Somebody deletes a whole secondary calendar | None you can rely on |
| A leader with edit rights makes a bulk mistake nobody notices for months | Trash expires at 30 days |
| The church account is compromised, locked, or closed | None |
| Access is lost because the service account key was revoked | Not data loss, but the same effect |

Two of those five have no net at all, and the 30-day window is short compared
to how long a quiet mistake can sit unnoticed on a calendar that is mostly
about next summer.

That is what this is for. It is not insurance against Google.

## What the job captures

Every run writes `backup/` containing, per calendar, the verbatim Google
Calendar API event resources. Not the classified shape the rest of the system
uses, and not the published `.ics` files, both of which are derived and lossy.
The snapshot keeps recurrence rules unexpanded, exception occurrences, and
cancellations, so a restore reproduces the calendar rather than an
approximation of it.

It covers **all** calendars, private ones included. That is exactly why it must
never be written to this repository, which is public. `backup/` is gitignored.

## Where it goes

A separate **private** GitHub repository, pushed to on every run where
something changed. Different provider from Google, versioned forever, free, and
access controlled. Every snapshot is a commit, so recovery is possible to any
point in time, not just to last night.

### Turning it on, step by step

Do all of this signed in as the **church** GitHub account, `greaterlifebaptist`.

**Part 1 — create the private repository.**

1. Go to <https://github.com/new>.
2. Owner: `greaterlifebaptist`. Repository name: `calendar-backup`.
3. Select **Private**. This is the whole point; it holds private calendars.
4. Tick **Add a README file**. The repo needs at least one commit or there is
   no branch to push to.
5. Click **Create repository**.

**Part 2 — create the access token.**

A token is how the job proves it may write to that repo. Make it able to do
that one thing and nothing else.

6. Click your avatar, top right, then **Settings**. This is account settings,
   not the repository's.
7. Left sidebar, scroll to the bottom: **Developer settings**.
8. **Personal access tokens** > **Fine-grained tokens**.
9. **Generate new token**.
10. Fill in:
    - **Token name**: `calendar-backup-writer`
    - **Expiration**: 1 year, and put a reminder in your calendar. Or **No
      expiration** if you would rather not have it stop. An expired token
      fails the run loudly, but a failed run is still a stopped backup.
    - **Resource owner**: `greaterlifebaptist`
11. **Repository access**: choose **Only select repositories**, then pick
    `calendar-backup`. Do not choose all repositories.
12. **Permissions** > **Repository permissions**. Find **Contents** and set it
    to **Read and write**. Leave everything else alone. Metadata will switch
    itself to read-only, which is expected.
13. **Generate token**, then **copy it**. It is shown once. If you lose it,
    delete it and make another.

**Part 3 — tell the calendar repo about it.**

14. Go to the `calendar` repo > **Settings** > **Secrets and variables** >
    **Actions**.
15. On the **Secrets** tab, **New repository secret**:
    - Name: `BACKUP_TOKEN`
    - Value: the token you copied
16. On the **Variables** tab, **New repository variable**:
    - Name: `BACKUP_REPO`
    - Value: `greaterlifebaptist/calendar-backup`

    Secrets and variables are different tabs and are not interchangeable. The
    workflow reads `BACKUP_TOKEN` as a secret and `BACKUP_REPO` as a variable.
    Putting either in the wrong place means it is simply not there.

**Part 4 — prove it works.**

17. **Actions** tab > **Calendar sync** > **Run workflow**.
18. Open the run and check the **Back up calendars** step. It should say
    `Snapshot pushed.` on the first run.
19. Open `calendar-backup` in the browser. You should see a `backup/` folder
    containing `manifest.json` and one JSON file per calendar.

Until `BACKUP_REPO` is set, every run prints a warning in the Actions summary
saying backups are off. If `BACKUP_REPO` is set but the token is missing or
wrong, the run **fails** rather than quietly pretending to back anything up.

## Restoring

Always dry run first. Nothing is written to Google without `--confirm`.

```bash
cd job && npm run restore -- --list
```

```bash
cd job && npm run restore -- --ministry youth
```

```bash
cd job && npm run restore -- --ministry youth --confirm
```

The restore adds events that are missing from the target calendar, matching on
`iCalUID`. It never deletes and never edits, so running it twice is safe and
running it against a half-recovered calendar fills the gaps instead of
duplicating them.

Cancelled occurrences are deliberately not restored. A cancellation is an
absence, and replaying it would resurrect a meeting somebody called off.

### After a calendar is deleted outright

Recover into a **new** calendar rather than trying to recreate the old one:

```bash
cd job && npm run restore -- --ministry youth --into <new-calendar-id> --confirm
```

Then paste the new id into `job/config/ministries.json` and commit. The
ministry id never changes, so every feed URL, QR code and subscription keeps
working. Doing it this way leaves the damaged calendar untouched in case the
restore turns out to be wrong.

You need `GOOGLE_SERVICE_ACCOUNT_JSON` in a local `.env` to run a restore, and
the service account needs "Make changes and see all event details" on the
target calendar.

### Restoring from an older point in time

The backup repo's history is the archive. Check out the commit from before the
damage and point the restore at that working copy:

```bash
git -C ../calendar-backup checkout <commit>
```

```bash
cd job && npm run restore -- --backup ../calendar-backup/backup --ministry youth
```

## What is still not covered

- **Sheet membership data.** Google Sheets keeps its own revision history,
  which is genuinely good, but it is inside the same account. Worth adding to
  the same snapshot once the Sheet exists.
- **The account itself.** Two-factor, recovery codes in the church safe, and a
  second admin are what protect that, not this. See CLAUDE.md section 11.
- **The service account key.** If it is lost, generate a new one. Nothing is
  destroyed, but the job stops until it is replaced.
