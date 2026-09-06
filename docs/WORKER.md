# The merge service

Merged calendar feeds are assembled when somebody's phone asks for them, by a
small Cloudflare Worker. Code is in [`worker/src/index.js`](../worker/src/index.js).

## Why it exists

A person picks two or three ministries and wants **one** calendar containing
all of them. Static hosting cannot merge anything, so the obvious answer is to
build every combination in advance. That is what this did first, and it worked
until it did not.

Combinations are `2^n`:

| Public ministries | Files | Size with a real calendar |
|---|---|---|
| 7 | 127 | ~0.6 MB |
| 8 | 255 | ~25 MB |
| 9 | 511 | ~50 MB, rebuilt hourly |
| 15 | **32,767** | hundreds of MB |

It ran out at about eight, which is one more than we have. Every one of those
files was also rebuilt and redeployed every hour whether anything changed or
not.

Merging on request removes the whole shape of the problem. Fifteen ministries
is fifteen source files, the same as one.

## What it does

```
phone  ──GET /c/church~youth.ics──►  Worker
                                       │  fetches /feeds/church.ics
                                       │          /feeds/youth.ics
                                       ▼
                                    one merged calendar
```

- **Nothing is stored.** It holds no copy of anything. Delete the Worker and
  redeploy it and nothing is lost, because there is nothing to lose.
- **Nothing is stale.** It reads whatever the per-ministry feeds contain at the
  moment of the request. A new event needs no rebuild here at all.
- **It takes events verbatim.** The job already produced correct RFC 5545 —
  folded to 75 octets, CRLF, recurrence rules intact — so the Worker copies the
  `VEVENT` blocks line for line rather than re-encoding them. It cannot
  introduce an encoding bug the job does not already have.
- **It de-duplicates.** An event a leader put on both the church and the youth
  calendar appears once, not twice.
- **It refuses a partial answer.** If one source feed is missing, the request
  fails rather than quietly returning a calendar that is short a ministry.
- **It canonicalises.** `/c/youth~church.ics` redirects to
  `/c/church~youth.ics`, so one selection cannot end up cached and bookmarked
  under several spellings.

Merged results are cached at the edge for five minutes, so twenty phones asking
for the same combination cost one merge.

## The naming rule

A slug is **sorted ministry ids joined with `~`**: `church~womens~youth`.

Three places build that string independently — `comboSlug` in
`job/src/combo.ts`, `comboSlug_` in `site/apps-script/Code.gs`, and the
subscribe buttons on the calendar page. If they ever disagree, somebody is
handed an address that resolves to nothing.

**The separator is `~`, not `-`, and that matters.** One ministry id already
contains a hyphen: `youth-leaders`. It is private today, so a hyphen separator
worked by luck — but ids are locked and the ministry list is not fixed, so the
day that one went public `church-youth-leaders` would have had two readings
and every saved URL would have turned ambiguous at once, with no way to rename
out of it. `~` cannot appear in an id and is unreserved in a URL. A test
checks this against **every** ministry, public and private, so making a private
one public can never be the moment it breaks.

## Where it runs

`https://calendar.greaterlifebaptist.workers.dev/c/<slug>.ics`

A different host from the site, because putting it on
`calendars.greaterlifebaptistchurch.com` means moving the whole domain's DNS to
Cloudflare, which touches the church website's records too. That can be done
later: the Worker will answer on both, so no existing subscription breaks.

## Deploying it

Automatic. [`.github/workflows/worker.yml`](../.github/workflows/worker.yml)
deploys on any push that touches `worker/`, then checks `/health` actually
answers before calling the run green. It is deliberately separate from the
hourly sync: the Worker changes about once a year, and a Worker problem must
not stop the calendar publishing.

It needs two repository **secrets**:

| Secret | Where from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare > My Profile > API Tokens > "Edit Cloudflare Workers" template, no expiry |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare > Workers & Pages, right-hand side |

## When it breaks

The hourly job fetches a merged feed every run and writes an **error
annotation** if it does not come back as a calendar. That shows on the run page
and in the run summary.

It is an annotation rather than a failed run on purpose: a Worker outage must
not stop the site and the per-ministry feeds from publishing, because those are
exactly what the Worker reads to recover.

What people would see meanwhile: subscribed calendars stop updating and phones
sit on their last copy. Nothing disappears.

To check by hand:

```bash
curl -sS https://calendar.greaterlifebaptist.workers.dev/health
```

It answers `ok 7 ministries`. Then a real feed:

```bash
curl -sS https://calendar.greaterlifebaptist.workers.dev/c/church~youth.ics | head -3
```

`BEGIN:VCALENDAR` means it is working.

## Limits

Cloudflare's free plan allows 100,000 requests a day and 10 ms of CPU per
request. Feeds are polled by each subscribed device on its own schedule, a few
times a day, so a few hundred subscribers is a few thousand requests — well
inside it. The merge itself is string work on a few hundred KB and the cache
absorbs the repeats.
