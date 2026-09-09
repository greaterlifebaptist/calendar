# Putting the calendar on the church website

The goal: people see `greaterlifebaptistchurch.com/calendar`, not the
subdomain, and nobody has to re-paste anything when the calendar page changes.

## What to do

Create (or edit) the WordPress page at `/calendar`, add a **Custom HTML** block,
and paste exactly this:

```html
<div id="glbc-calendar"></div>
<script src="https://calendars.greaterlifebaptistchurch.com/embed.js" defer></script>
```

That is the whole thing. Publish the page.

The calendar renders inside your own page, at your own address, and the design,
the data and the code all live on the calendar host and update themselves.
There is nothing here to maintain.

## Why not the other ways

**A redirect** sends people to the subdomain and the address bar changes. It
works, but it is not what was wanted.

**An iframe** keeps your address but breaks real things. Add to home screen
stops working, the QR code on the overflow-room TV points at the wrong place,
and personal feed links misbehave inside a frame.

**Pasting the page's HTML** works on day one and then quietly goes stale. The
event data would stay current while the page itself fell behind, and nobody
would notice until a redesign never appeared.

## What it will and will not touch

Everything the widget draws is scoped to `#glbc-calendar`, and it starts with a
reset, so:

- The church theme cannot bleed into the calendar. A theme that puts borders on
  every `div` or makes every heading pink does not reach inside.
- The calendar cannot bleed out. Nothing it defines applies to the rest of the
  page.

The reset was not thorough enough the first time, and the way it failed is
worth remembering: **the widget looked perfect on the subdomain and wrong on
the church site**, because on the subdomain there is no theme to lose to. A
line-height pushed the day out of the top of every date chip, and a rule
rounding every button curved the active tab's underline into a swoosh.

Inherited properties — font, line-height, colour, letter-spacing, alignment —
are set to `inherit` rather than to a fixed value. Pinning them would beat the
theme but would also stop our own container passing anything down, so every
size and colour would have to be restated on each element. `inherit` does both
jobs: a theme rule on a descendant cannot outrank an id-scoped one, and our own
cascade still flows.

`font-weight` is the exception, left alone deliberately: resetting it on
everything would flatten every `<b>` in the markup.

### Testing it against a theme

[`site/embed-test.html`](../site/embed-test.html) is a deliberately hostile
host page — line-heights, rounded buttons, wavy underlines, forced uppercase,
list bullets, borders, centred text, all applied to every element inside the
content area. Open it next to `index.html` and they should look identical.

It has two modes, and the difference matters. Ordinary theme rules lose to the
reset, which is what almost every theme uses. A theme using `!important` wins
by definition — nothing scoped can outrank it, and only shadow DOM would.

If the calendar ever looks wrong on the church site again, that page is the
first place to reproduce it.

It loads three Google fonts, and skips them if the page already has them.

## The links inside it

"Get your own calendar" and "Leaders" point back at the calendar host, since
those pages live there. The subscribe buttons hand out feed addresses on the
host too. That is correct: those are not pages, they are calendar
subscriptions, and they must be stable regardless of which site somebody
started from.

## If it does not appear

**Check the block type.** WordPress will escape a `<script>` tag in a
paragraph block. It must be a **Custom HTML** block, or a full-page HTML
template.

**Check the browser console** for a line beginning `[glbc]`. It says so plainly
when the `<div>` is missing.

**Some hosts strip script tags** from post content, especially with certain
security plugins. If so, the same two lines will work in a page template, or
via a plugin that permits raw HTML.

## When the calendar page changes

Nothing on the WordPress side. But whoever edits `site/index.html` must run:

```bash
node scripts/build-embed.mjs
```

`site/embed.js` is generated from that page, so the two cannot drift. The build
refuses to write if the page has changed shape enough that its rewrites no
longer apply, rather than shipping a broken widget.
