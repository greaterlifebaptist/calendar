# TV display — agreed design

Not built yet. This records the design so it is not relitigated later. It comes
after the reminder engine, which is the primary need in CLAUDE.md section 1.

## The screen

An 85 inch TV in the overflow room, already used for live streaming. People
stand around it before and after service and at special events. Viewing
distance is roughly fifteen to twenty feet, landscape.

That distance drives everything. What exists today at `?display=tv` is tuned
for a tablet at arm's length and is far too small for this. Body text wants to
be around 32 to 40 pixels at 1080p, headlines much larger.

Wall tablets come later and may want a different, possibly interactive,
variant. Build for the TV first.

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

## Later

- Photos or slideshow panels interleaved with the spotlight.
- A scaled down or interactive variant for wall tablets.
