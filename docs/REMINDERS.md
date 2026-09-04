# Reminders

Automatic GroupMe nudges about deadlines, on a ladder. This is the reason the
project exists, and the only part that can do real harm.

**It is off.** Reminders are a dry run by default and stay that way until
somebody deliberately sets a repository variable. Configuring a GroupMe bot is
setup, not consent to start messaging people.

## The ladder

| Type | When it reminds |
|---|---|
| `deadline` | a month, a week, a day before, and on the day |
| `trip` | a month, a week and a day before |
| `event` | a week and a day before |
| `routine` | never |

Plus a **weekly digest** on Sunday evening, listing the week ahead. If the week
is empty it says nothing, because a digest with nothing in it teaches people to
ignore digests.

Reminders go out **once a day at 9am local**. The job runs hourly, so without
that the same nudge would land twenty-four times.

### Recurring series are throttled, not silenced

A daily, weekly or biweekly series gets the full ladder for its **first**
upcoming occurrence, then only the day-before nudge for each one after. A
six-week Wednesday class would otherwise send twelve messages, and its
week-ahead notice would always arrive the day after the previous week's
session. A monthly or rarer series is not frequent enough to be a nuisance and
is left alone.

## Read every message before any of them are real

```bash
cd job && npm run preview:reminders
```

This walks forward day by day and prints every message the ladder would send,
in full, with the dates it would send them. It sends nothing and does not touch
the saved state. `--days 60` looks further ahead; `--fixtures` runs it against
the sample calendar instead of the real one.

## The guards

Each of these exists because of a specific way this could go wrong.

**Once a day, not once an hour.** Reminders are only considered at the send
hour.

**Every send is recorded**, keyed on the event and the rung, in
`job/state/reminders.json`, committed back to the repo each run. Without it the
hourly job would repeat itself.

**The first run sends nothing.** With no state file, it records everything it
*would* have sent and sends none of it. Otherwise switching this on fires every
rung for everything already on the calendar, at everybody, at once.

**A corrupt state file stops the run.** An unreadable file is not treated as
"nothing has been sent yet", because that reading re-sends the lot.

**A blast guard.** A run wanting more than twelve messages sends none of them
and fails loudly. If that trips it is a bug, not a busy week.

**A dry run records nothing.** Anything logged rather than sent is still owed,
so nothing is quietly skipped when it goes live.

## Turning it on

1. **Make a GroupMe bot on a private test group.** Create a group with only
   yourself in it, then a bot at <https://dev.groupme.com/bots> attached to it.
   Leave the callback URL blank: we only ever send.
2. Add the bot id as the repo secret `GROUPME_BOT_YOUTH_PARENTS`.
3. Let it run for a few days. Every run logs what it would have sent, so the
   Actions log becomes the record to review.
4. When you are satisfied, add the repository **variable** `REMINDERS_LIVE`
   with the value `true`. That is the moment it starts sending.

To go live for real parents, make a **second** bot in the real group and swap
the secret. Keep the test bot so there is always somewhere safe to test.

To stop it again, delete `REMINDERS_LIVE` or set it to anything other than
`true`. Nothing else needs changing.

## Who receives what

Configured per ministry in `job/config/ministries.json`, as `notify`. Today only
`youth` has a channel, `youth-parents`. Adding another ministry is a config
entry plus a secret, not code.

A ministry with no channel is never reminded about at all, however its events
are classified.

## What it will not do

- **Message individuals.** GroupMe groups only. There is no per-person
  messaging anywhere in this system, and no email.
- **Remind about private ministries** unless one is given a channel, which none
  currently has. Think carefully before doing that: a GroupMe message is a
  copy of the information leaving the system entirely.
- **Catch up.** A missed send is missed. It will not fire late, because a
  reminder arriving after the deadline is worse than none.
