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
| `not the send hour` | It is not 9am. Normal for 23 runs out of 24. |
| `nothing due right now` | It is 9am, but no event is on a rung today. |
| `next up: ...` | The next few dates anything is due, so a quiet run is not a mystery. |
| `no ministry has a GroupMe channel` | Nothing will ever send. Check `notify` in the config. |
| `DRY RUN so nothing will be sent` | Working normally, just rehearsing. |

The most common reason for silence is simply that no event is seven or one
days away yet. An event thirteen days out has no rung today; the ladder only
fires at 30, 7, 1 and 0 days depending on type.

## Read every message before any of them are real

This one needs a terminal. The `next up` lines in the Actions log cover most of
the same ground without one.

Open a terminal in the folder holding this repo, then:

```bash
cd job && npm run preview:reminders
```

It walks forward a day at a time and prints every message the ladder would
send, in full, with the date it would send it. It sends nothing and does not
touch the saved state. Add `-- --days 90` to look further ahead, or
`-- --fixtures` to run against the sample calendar instead of the real one.

## The guards

Each of these exists because of a specific way this could go wrong.

**Once a day, not once an hour.** Reminders are only considered at the send
hour.

**Every send is recorded**, keyed on the event and the rung, in
`job/state/reminders.json`, committed back to the repo each run. Without it the
hourly job would repeat itself.

**The first run sends nothing.** With no state file, it records whatever is due
at that moment as already handled and sends none of it, so switching this on
cannot fire a backlog. This happens on the first run of any kind, including a
quiet one, so the file is in place long before anybody tries a real send. It
used to wait for the first run that had something to send, which meant the very
first deliberate test was swallowed.

**A corrupt state file stops the run.** An unreadable file is not treated as
"nothing has been sent yet", because that reading re-sends the lot.

**A blast guard.** A run wanting more than twelve messages sends none of them
and fails loudly. If that trips it is a bug, not a busy week.

**A dry run records nothing.** Anything logged rather than sent is still owed,
so nothing is quietly skipped when it goes live.

## Testing it on demand

**Run workflow** has two tick boxes. Both are unticked by default, and ticking
either means "do more than usual".

| Box | Unticked | Ticked |
|---|---|---|
| `really_send` | writes the messages to the log only | actually posts to GroupMe |
| `send_now` | waits for 9am | works out reminders right now |

To rehearse, tick **send_now** only and read the log. To actually receive one,
tick **both**.

These were once a single box labelled "log reminders instead of sending them",
which defaulted to ticked. It read like the helpful option, so ticking it was
the natural thing to do, and it silently prevented every send.

`send_now` overrides the hour and nothing else. The dedupe state and the blast
guard still apply, so it cannot cause a send that would not have happened at
9am anyway.

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

**4. Rehearse.** Actions, Calendar sync, **Run workflow**, tick **send_now**
only. The log shows every message it would have sent, without sending any.

**5. Send to yourself.** Add the repository **variable** `REMINDERS_LIVE` with
the value `true`, on the **Variables** tab, no quotes. Run the workflow again
with **both** boxes ticked. The bot still points at your test group, so it
arrives with you and nobody else. After that leave it on the ordinary hourly
schedule for a few days.

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
