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
