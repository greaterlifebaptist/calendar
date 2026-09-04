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
