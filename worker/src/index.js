/**
 * Merged calendar feeds, assembled on request.
 *
 * A person picks some ministries and wants one calendar containing all of
 * them. The obvious way to serve that from static hosting is to build every
 * combination in advance, and that works right up until it does not: subsets
 * are 2^n, so seven ministries is 127 files and fifteen is 32,767, rebuilt and
 * redeployed every hour for no gain.
 *
 * So nothing is built in advance. This merges the handful of per-ministry
 * feeds somebody actually asked for, at the moment they ask, and forgets it.
 * The number of ministries stops mattering: fifteen ministries is fifteen
 * source files, the same as one.
 *
 * It holds no copy of anything. The job publishes /feeds/<id>.ics hourly from
 * Google Calendar, and this reads whatever is there at the moment of the
 * request, so a new event needs no rebuild here at all.
 *
 *   GET /c/church~youth.ics   ->  church + youth, as one calendar
 *   GET /health               ->  plain text, for the hourly job to check
 *
 * The slug is sorted ministry ids joined with "~". job/src/combo.ts and
 * Code.gs build the same string; all three must agree or somebody is handed an
 * address that resolves to nothing. The separator is not "-" because an id may
 * contain one, and youth-leaders does.
 */

const SITE = 'https://calendars.greaterlifebaptistchurch.com';

/** How long the edge may serve a merge without re-reading the source feeds. */
const CACHE_SECONDS = 300;

/**
 * A calendar app that polls every five minutes should not be able to make us
 * re-read fifteen files each time, and a slug of a thousand parts should not
 * be worth trying. Comfortably above any real selection.
 */
const MAX_PARTS = 20;

const CRLF = '\r\n';

function text(body, status, type) {
  return new Response(body, {
    status: status,
    headers: {
      'content-type': type || 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * The ministries somebody may ask for: public, and actually online.
 *
 * Read from the site rather than hardcoded, so bringing a ministry online or
 * making one private is a config change in one place and this follows. Cached
 * briefly because it changes about once a year.
 */
async function publicMinistries(ctx) {
  const res = await fetch(SITE + '/ministries.json', {
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error('ministries.json returned ' + res.status);
  const data = await res.json();
  const out = new Map();
  for (const m of data.ministries || []) {
    if (m && m.id && m.visibility === 'public' && m.calendarId) out.set(m.id, m.name || m.id);
  }
  return out;
}

/**
 * Pull the VEVENT blocks out of a feed, and the VTIMEZONE from the first one.
 *
 * Deliberately does not parse or re-emit anything. The job already produced
 * correct RFC 5545: folded to 75 octets, CRLF, recurrence rules intact. Taking
 * the lines verbatim means this cannot introduce a bug the job does not have,
 * and it cannot lose a property it does not know about.
 */
export function splitFeed(body) {
  const lines = body.split(/\r\n|\n|\r/);
  const events = [];
  const timezone = [];
  let current = null;
  let inTimezone = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = [line]; continue; }
    if (current) {
      current.push(line);
      if (line === 'END:VEVENT') { events.push(current); current = null; }
      continue;
    }
    if (line === 'BEGIN:VTIMEZONE') { inTimezone = true; timezone.push(line); continue; }
    if (inTimezone) {
      timezone.push(line);
      if (line === 'END:VTIMEZONE') inTimezone = false;
    }
  }
  return { events: events, timezone: timezone };
}

/**
 * What makes two entries the same event.
 *
 * Normally nothing collides: an event lives on exactly one ministry calendar.
 * But a leader who puts one revival on both the church and the youth calendar
 * would otherwise have it drawn twice in the merged feed, which reads as a
 * mistake in the calendar rather than in us. RECURRENCE-ID is part of the key
 * so that a moved occurrence is not mistaken for its own series.
 */
export function identity(block) {
  let uid = '';
  let recurrence = '';
  for (const line of block) {
    if (line.startsWith('UID:')) uid = line.slice(4);
    else if (line.startsWith('RECURRENCE-ID')) recurrence = line;
  }
  return uid ? uid + '|' + recurrence : block.join('|');
}

/** RFC 5545 line folding, for the header lines this file writes itself. */
export function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let chunk = '';
  let used = 0;
  let limit = 75;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (used + size > limit) {
      out.push(chunk);
      chunk = ' ' + ch;
      used = 1 + size;
      limit = 75;
    } else {
      chunk += ch;
      used += size;
    }
  }
  out.push(chunk);
  return out.join(CRLF);
}

export function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export async function buildMerged(ids, names) {
  const responses = await Promise.all(
    ids.map((id) => fetch(SITE + '/feeds/' + id + '.ics', {
      cf: { cacheTtl: 60, cacheEverything: true },
    })),
  );

  // One missing source feed would silently drop a ministry somebody asked
  // for, and their calendar would just be short a few events with nothing to
  // say so. Better to fail the request and let the health check shout.
  for (let i = 0; i < responses.length; i++) {
    if (!responses[i].ok) {
      throw new Error('feed ' + ids[i] + ' returned ' + responses[i].status);
    }
  }

  const bodies = await Promise.all(responses.map((r) => r.text()));

  let timezone = [];
  const seen = new Set();
  const events = [];
  for (const body of bodies) {
    const part = splitFeed(body);
    if (!timezone.length) timezone = part.timezone;
    for (const block of part.events) {
      const key = identity(block);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(block);
    }
  }

  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Greater Life Baptist Church//GLBC Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + escapeText('Greater Life Baptist Church')),
    'X-WR-TIMEZONE:America/New_York',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    fold('X-WR-CALDESC:' + escapeText('Greater Life Baptist Church — ' + names.join(', '))),
  ];
  rows.push(...timezone);
  for (const block of events) rows.push(...block);
  rows.push('END:VCALENDAR');
  return rows.join(CRLF) + CRLF;
}

async function handleCombo(slug, request, ctx) {
  const parts = slug.split('~').filter(Boolean);
  if (!parts.length || parts.length > MAX_PARTS) {
    return text('Not a calendar address.', 400);
  }

  const known = await publicMinistries(ctx);
  const ids = [];
  const names = [];
  for (const part of parts) {
    if (!known.has(part)) {
      // Naming the unknown part is worth more than hiding it: everything here
      // is public, and "youth-leaders is not available" is the answer somebody
      // needs, where a bare 404 sends them to ask whether the site is broken.
      return text('No calendar called "' + part + '".', 404);
    }
    if (ids.includes(part)) continue;
    ids.push(part);
    names.push(known.get(part));
  }

  // The slug is canonical: sorted, deduplicated. Anything else redirects to
  // the one true address, so the same selection cannot end up cached, shared
  // and bookmarked under half a dozen spellings.
  const canonical = [...ids].sort().join('~');
  if (canonical !== slug) {
    return Response.redirect(new URL('/c/' + canonical + '.ics', request.url).toString(), 301);
  }

  const ics = await buildMerged(ids, names);
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'public, max-age=' + CACHE_SECONDS,
      'content-disposition': 'inline; filename="' + slug + '.ics"',
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text('Only GET.', 405);
    }

    if (url.pathname === '/health') {
      try {
        const known = await publicMinistries(ctx);
        return text('ok ' + known.size + ' ministries', 200);
      } catch (err) {
        return text('unhealthy: ' + (err && err.message ? err.message : err), 503);
      }
    }

    const match = /^\/c\/([a-z0-9~-]{1,300})\.ics$/.exec(url.pathname);
    if (!match) {
      return text('Calendar feeds live at /c/<ministries>.ics — see ' + SITE, 404);
    }

    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    let res;
    try {
      res = await handleCombo(match[1], request, ctx);
    } catch (err) {
      // Never cache a failure. A phone that polls twice a day would otherwise
      // hold a broken calendar for as long as the cache lived.
      return text('The calendar could not be assembled just now. ' +
        (err && err.message ? err.message : ''), 502);
    }

    if (res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};
