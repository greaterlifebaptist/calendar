# TV display

**Built.** Live at `/tv`, or `/tv?ministry=youth,church` to narrow it.
The old `/?display=tv` address redirects here.

What follows is the design it was built to.

## The screen

An 85 inch TV in the overflow room, already used for live streaming. People
stand around it before and after service and at special events. Viewing
distance is roughly fifteen to twenty feet, landscape.

That distance drives everything. Body text sits around 36px at 1080p and rail
headlines around 40px, which is roughly the minimum that reads at twenty feet
on a screen this size.

Wall tablets come later and may want a different, possibly interactive,
variant.

## Layout

```
┌──────────────────────────────────┬───────────────────┐
│                                  │  COMING UP        │
│   Rolling four weeks             │                   │
│   Current week always on top     │  Permission forms │
│                                  │  due — 6 days     │
│   ┌────┐                         │                   │
│   │ 14 │ ← spotlight zooms       │  Trip deposit     │
│   └────┘   into a date           │  $75 — Feb 14     │
│                                  │                   │
│                                  │  Fall lock-in     │
│                                  │  Nov 13           │
│                          ▓▓ QR   │                   │
└──────────────────────────────────┴───────────────────┘
        left two thirds                 right third
```

**Left two thirds.** A rolling four week grid, current week always on top. Not
a calendar month: a month grid is nearly useless on the 28th, when it shows
three days ahead. Rolling weeks always show the same amount of future.

**Right third.** A standing list of what is coming up soon, driven by the same
`pinned` flag and `deadline` type the website already uses. This never
rotates. Anything due within about ten days sits here with a countdown, so the
single most important information on the screen is never something you have to
wait for.

**QR code**, permanently in a corner, pointing at the calendar page. It turns
a glance in the overflow room into a person subscribed to reminders, which is
the cheapest distribution this project will ever get. It should carry a short
label, something like "Put this on your phone".

## The spotlight cycle

Only days that carry something worth stopping for. Weekly services are not on
these calendars at all, so in practice that means every day with an event, but
the rule still holds: skip anything classified `routine`.

The cycle for each featured day:

1. Hold on the full grid, so somebody looking for their own date can find it
   without waiting for the rotation to reach it.
2. Zoom into the date cell. The cell expands into a panel showing every event
   that day with time, location and notes.
3. Zoom back down into the cell.
4. Pause on the full grid again before the next one.

The pause in step 4 matters and was the point Spencer raised: without it the
screen is never showing the plain overview, and a person who just wants to
scan the month is stuck waiting. Suggested timings, all tunable:

| Phase | Seconds |
|---|---|
| Grid hold between spotlights | 4 |
| Zoom transition | 0.6 |
| Spotlight hold | 9 |

Animate transform and opacity only, so a long-running browser keeps the work
on the GPU. Honour `prefers-reduced-motion` by cross-fading instead of zooming.

## Data

All public ministries combined, colour coded, rather than rotating one
ministry's calendar at a time. Rotating whole calendars means a youth parent
stands watching the men's calendar for twenty seconds.

`?ministry=` should still filter, so a future tablet in the youth building can
show youth and church-wide only.

## What reaches the rail

Events from whichever ministries are showing, soonest first, **within the next
six weeks**.

There was no horizon at first, on the theory that a quiet month should reach
further than a busy one. What that actually produced was a fundraiser deadline
five months out leading the wall, above things happening that week — because
deadlines lead, and a deadline entered early is still a deadline. This screen
is read by somebody walking past on a Sunday, so its subject is what is coming
soon, and anything further off belongs on the website where people go to plan.

Six weeks rather than four so a deadline is still on the wall when its first
GroupMe reminder goes out at thirty days, instead of vanishing that morning.
The number is a script property, `TV_DAYS`, changed from the Notices tab of
the admin page — the church has no computer, so a number only reachable from a
script editor is a number nobody will change.

**An event can also be held back by date.** "Put it on the TV from" in the
admin form, or a `show: 2027-01-15` line in the description, keeps something
off the wall until that morning: a fundraiser deadline is worth recording the
moment somebody thinks of it and has no business on the wall until the
fundraiser starts. **It touches the wall and nothing else.** The website lists the event, the
feeds carry it, and its reminders run off its own date.

It briefly did more than that — hiding the event from the website and silencing
its reminders — on the reasoning that a message about something invisible is a
message nobody can act on. The example that justified it, a reminder months
ahead of an event, is not something the ladder can produce: the furthest rung
is thirty days. So it was taking away two things nobody had asked to lose, to
prevent something that could not happen.

**An event can also be kept off the wall entirely**, with "Keep it off the TV"
on the admin form. Separate from the date, for something that belongs on the
calendar and never belongs on a screen read in two seconds. It changes nothing
else — website, feeds and reminders all carry on.

The date is checked in the browser rather than filtered out when the file is
built, so the event appears on the right morning rather than at whatever hour
the next build happens to run.

Deadlines and pinned items lead the list. They used to *replace* the rest of it
rather than lead it, so one permission-form deadline could push every other
event off the wall. That was defensible when three rows fit; now that the rail
scrolls there is room to show what is urgent first and still show the rest.

The heading is always "Coming up". It used to switch to "Don't forget" whenever
anything in the list was a deadline, which meant the wall changed its own
heading under a reader who had glanced away, for no gain — the rows say which
ones are due.

Eight rows at most, `RAIL_MAX`. That is really a limit on how long somebody
waits for the list to come back round to the thing they were looking for:
roughly five seconds a row plus the pause, so eight is about three quarters of
a minute.

Nothing is trimmed to fit. It used to be — a half-cut row looked broken when
the rail was static and nobody could scroll a wall. The crawl exists to show
what does not fit, so trimming deleted exactly what it was built to reveal,
and did it silently: the symptom was the item count changing with browser zoom.

## The wall notice

One message, across the top of the right column, above everything else. For
"service moved to 6pm" on the morning it happens — which is the case that
decided how it is built.

Set it on the admin page, **Wall notice** tab. It shows what is currently on
the screen, so nobody has to remember whether they took the last one down.

**It appears within two minutes**, because the TV polls the endpoint directly
rather than waiting for the hourly job. Anything going through the job could
sit for fifty-five minutes, by which time the service has started, and that
single case is the whole reason this feature exists.

**An end date is enforced on the server, not the screen.** A wall display that
has been running since spring is the last thing that should be judging whether
a message is still true, and its clock is one power cut away from being wrong.
The notice shows through the END of the chosen day: "until Sunday" means
Sunday, and one vanishing mid-service would be worse than one lingering an
afternoon.

Leaving the date blank keeps it up until somebody takes it down. A date is
safer — nothing looks worse on a wall than last month's urgent notice.

Clearing is the same action as setting, with the message emptied, so whoever
put one up in a hurry can take it down from the box they typed it into. An
empty **save** is refused rather than treated as a clear, so a stray click
cannot take a notice down silently.

**The rail crawls when it no longer fits — and only then.** A notice pushes
"Coming up" down, and on a busy week the last item or two would fall off the
bottom with nothing to say so. A list that fits does not move at all.

It scrolls at about five seconds a row, slow enough to read on the way past,
then **rests for five seconds with the top of the list showing** before going
round again. The rest lands exactly where the rule clears the top of the
window, so it is the pause somebody needs to read the first two items properly
rather than an arbitrary stop.

The loop has no seam. The list is duplicated below itself with a rule between,
and the travel is exactly the height of the first copy plus that rule — so at
the moment it wraps, the copy is sitting precisely where the original began and
nothing visibly moves. A loop that snaps back to the top reads as a fault, and
without the rule you cannot tell where the list ended and started again.

Speed is **seconds per row, not pixels per second**, so it reads the same on a
1080p screen and a 4K one, and it is averaged across the rows rather than
measured off the first — that one carries a countdown chip and is taller than
the rest. `CRAWL_SECS_PER_ROW` and `CRAWL_PAUSE_MS` are the two numbers worth
adjusting once it is on a real wall across a real room.

The keyframes are written from JavaScript rather than sitting in the
stylesheet, because both numbers depend on measurement: the travel is the
height of this particular list, and the rest is a share of a duration that
follows from it. A keyframe selector cannot take a custom property.

`RAIL_MODE` at the top of the script switches between `"scroll"` and
`"page"`, which holds a screenful, fades, and moves on. Anything else means no
motion at all and the overflow simply is not seen. A device asking for reduced
motion gets paging regardless: a wall that never stops moving is exactly what
that setting is asking to avoid.

Both modes move a layer **inside** the list's window rather than the window
itself. Transforming the window took its own clipping edge with it and the
list rode up over the "Coming up" heading.

## Running for months

This screen is switched on and then left alone, so everything below is about
what happens on day ninety rather than day one.

**Data refreshes every fifteen minutes**, by refetching `events.json` rather
than reloading the page. That distinction matters: a reload during a network
blip leaves a blank wall until the network returns, where a failed refetch
leaves the last good calendar on screen. If the fetch fails there is a saved
copy in `localStorage` behind it, and a banner saying how old it is.

**The date rolls over on its own.** A minute tick watches for the day changing
and redraws, so the grid and the "today" outline move at midnight without
anybody touching it.

**The page reloads itself once a night, in the 4am hour.** Not for the data —
that refreshes anyway — but for the CODE. Without it the wall runs whatever
JavaScript it loaded when it was switched on, for months, and a change to this
page would sit undelivered. It also means the browser never runs more than a
day, so it cannot accumulate a month of memory.

Three things guard it:

- **It checks the site answers before reloading.** A blind reload while the
  network is down would turn a working screen showing yesterday's calendar into
  a browser error page, at 4am, with nobody awake to see it — undoing every
  other decision on this page. If the check fails it carries on and tries again
  tomorrow.
- **It acts within a five minute window**, and only after thirty minutes of
  uptime, so a reload at 4:00 cannot qualify again at 4:01 and leave the screen
  reloading in a loop for an hour.
- **4am, not midnight**, so it is safely past the 2am daylight saving change
  rather than inside it.

Booting during the window simply skips that night.

## Verified

- Four rolling weeks, always starting with the current week.
- Sixty seven / thirty three split, rail never rotates.
- Only days carrying a non-routine event are spotlighted.
- The spotlight grows out of the day cell it is describing, and that cell is
  outlined while it is up.
- Type sized for an 85 inch screen: rail headlines around 40px at 1080p,
  which is roughly the minimum that reads at twenty feet.
- The rail trims itself to the rows that actually fit, because a row cut in
  half at the bottom of a wall display looks broken and nobody can scroll it.

## Later

- Photos or slideshow panels interleaved with the spotlight.
- A scaled down or interactive variant for wall tablets.
