# Backups

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

### Turning it on

1. Create a **private** repo on the `greaterlifebaptist` account, for example
   `calendar-backup`. Initialise it with a README so it has a branch.
2. Create a fine-grained personal access token: Settings > Developer settings >
   Personal access tokens > Fine-grained tokens.
   - Repository access: **only** the backup repo.
   - Permissions: Contents **read and write**. Nothing else.
   - Expiry: set a reminder, or choose no expiry. An expired token fails the
     run loudly rather than silently, but a failed run is still a stopped
     backup.
3. In the `calendar` repo, add:

   | Where | Name | Value |
   |---|---|---|
   | Secrets | `BACKUP_TOKEN` | the token |
   | Variables | `BACKUP_REPO` | `greaterlifebaptist/calendar-backup` |

Until `BACKUP_REPO` is set, every run prints a warning in the Actions summary
saying backups are off. If `BACKUP_REPO` is set but the token is missing, the
run fails rather than pretending to back anything up.

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
