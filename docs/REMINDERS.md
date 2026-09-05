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

## Why nothing was sent

Every run prints the reminder section, whether or not anything went out, and
says which of these is true:

| The log says | Meaning |
|---|---|
|  | It is not 9am. Normal for 23 runs out of 24. |
|  | It is 9am, but no event is on a rung today. |
|  | The next few dates anything is due, so a quiet run is not a mystery. |
|  | Nothing will ever send. Check  in the config. |
|  | Working normally, just rehearsing. |

The most common reason for silence is simply that no event is seven or one
days away yet. An event thirteen days out has no rung today; the ladder only
fires at 30, 7, 1 and 0 days depending on type.

## Read every message before any of them are real

```bash
cd job && npm run preview:reminders
```This needs a terminal, and the  lines in the Actions log cover the
same ground without one.



Run it from a terminal in the folder holding this repo. It walks forward day by day and prints every message the ladder would send,
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

## Testing it on demand

Reminders only fire at 9am local, which makes them awkward to try out at four
in the afternoon. The **Run workflow** button has a **send_now** tick box that
ignores the send hour for that one run.

It ignores the hour and nothing else. Dry run, the dedupe state and the blast
guard all still apply, so ticking it cannot cause a send that would not have
happened at 9am anyway.

Locally the same thing is `--send-now`:

```bash
cd job && npm start -- --send-now
```

## Turning it on

**1. Make the test group.** In GroupMe, start a new group with only yourself
in it. Call it something like "GLBC Calendar Bot Test".

**2. Make the bot.** Go to <https://dev.groupme.com/bots>, signed in with the
same GroupMe account, and press **Create Bot**.

  | Field | Value |
  |---|---|
  | Group | the test group you just made |
  | Name | `GLBC Calendar` |
  | Callback URL | **leave blank** — we only ever send, never receive |
  | Avatar URL | optional |

  Submit, then copy the **Bot ID**.

**3. Add it as a secret.** In the repo: Settings, Secrets and variables,
Actions, **Secrets** tab, New repository secret. Name
`GROUPME_BOT_YOUTH_PARENTS`, value the bot id. Nothing starts sending yet.

**4. Dry run it.** Actions, Calendar sync, **Run workflow**, tick **send_now**,
leave **dry_run** ticked. The log shows every message it would have sent.

**5. Send to yourself.** Add the repository **variable** `REMINDERS_LIVE` =
`true`. The bot still points at your test group, so the next run delivers real
messages to you and nobody else. Watch it on the ordinary hourly schedule for a
few days.

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
