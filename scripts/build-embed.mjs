/**
 * Build site/embed.js from site/index.html.
 *
 * The church website wants the calendar at greaterlifebaptistchurch.com/calendar
 * rather than on the subdomain, and wants it to keep working without anybody
 * re-pasting HTML every time the page changes. An iframe would keep the URL but
 * breaks add-to-home-screen, the TV's QR code and the personal feed links.
 *
 * So the calendar is published as a widget: two lines in a WordPress Custom
 * HTML block, and everything else lives here and updates itself.
 *
 * Generating it from index.html rather than maintaining a second copy is the
 * point. Two copies of a page drift, and the drift is invisible until somebody
 * notices the church website is a version behind.
 *
 *   node scripts/build-embed.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER = '#glbc-calendar';

const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
const rawCss = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const rawBody = /<body>([\s\S]*)<\/body>/.exec(html)[1].split(/<script/)[0].trim();
let js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .join('\n');

// ---------------------------------------------------------------------------
// CSS: scope everything, so a WordPress theme cannot bleed in or out
// ---------------------------------------------------------------------------

const css = rawCss
  .split('\n')
  .map((line) => {
    if (/^:root\{/.test(line)) return line.replace(':root{', CONTAINER + '{');
    if (/^html,body\{/.test(line)) return '';
    if (/^body\{/.test(line)) return line.replace('body{', CONTAINER + '{');

    const m = /^([.#a-zA-Z*[][^{@]*)\{/.exec(line);
    if (!m) return line;

    const selectors = m[1]
      .split(',')
      .map((raw) => {
        const s = raw.trim();
        if (!s || s.startsWith(CONTAINER)) return s;
        // `body.tv .foo` becomes `#glbc-calendar.tv .foo`: the container itself
        // carries the mode class, since there is no body to put it on.
        if (s.startsWith('body.tv')) return CONTAINER + '.tv' + s.slice('body.tv'.length);
        return CONTAINER + ' ' + s;
      })
      .join(',');

    return selectors + line.slice(m[0].length - 1);
  })
  .filter((line) => line !== '')
  .join('\n');

/**
 * A reset, first, so the host theme's own rules lose.
 *
 * Scoping our selectors stops us leaking outwards, but it does nothing about a
 * theme's generic `section, div, p { border-left: 2px }` or `button { ... }`
 * reaching in. Anything we do not explicitly set would inherit it. This
 * neutralises the usual offenders, and every rule below overrides it.
 */
const RESET = [
  CONTAINER + ',',
  CONTAINER + ' *,',
  CONTAINER + ' *::before,',
  CONTAINER + ' *::after{',
  '  box-sizing:border-box;margin:0;padding:0;border:0;outline:0;',
  '  background:none;box-shadow:none;float:none;position:static;',
  '  text-transform:none;letter-spacing:normal;text-indent:0;text-align:left;',
  '  list-style:none;text-decoration:none;font-style:normal;',
  '  min-width:0;max-width:100%;width:auto;height:auto;',
  '}',
  CONTAINER + '{max-width:100%;overflow-x:clip;isolation:isolate}',
  CONTAINER + ' img{max-width:100%;height:auto}',
].join('\n');

const stillGlobal = css
  .split('\n')
  .filter((l) => /^[.#a-zA-Z*[][^{@]*\{/.test(l) && !l.startsWith(CONTAINER));
if (stillGlobal.length) {
  console.error('Unscoped selectors would leak into the host page:');
  for (const l of stillGlobal) console.error('  ' + l);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Markup: links point back at the calendar host, wherever this is embedded
// ---------------------------------------------------------------------------

const body = rawBody
  .replace(/href="\.\/signup\.html"/g, 'href="__BASE__/signup"')
  .replace(/href="\.\/admin\.html"/g, 'href="__BASE__/admin"');

// ---------------------------------------------------------------------------
// Script: fetch from the calendar host, and work inside the container
// ---------------------------------------------------------------------------

const before = js;
js = js
  .replace(/"\.\/events\.json\?t="/g, 'BASE + "/events.json?t="')
  .replace(/const \$ = id => document\.getElementById\(id\);/,
    'const $ = id => HOST.querySelector("#" + id);')
  .replace(/document\.body\.classList\.add\("tv"\)/g, 'HOST.classList.add("tv")')
  // The standalone page redirects ?display=tv to the TV page. Embedded in
  // somebody else's site, hijacking their navigation would be rude.
  .replace(/^if \(TV\) location\.replace\(.*$/m, '');

for (const [what, pattern] of [
  ['events.json fetch', /BASE \+ "\/events\.json\?t="/],
  ['scoped $()', /HOST\.querySelector/],
]) {
  if (!pattern.test(js)) {
    console.error('Expected rewrite missing: ' + what + '. Has index.html changed shape?');
    process.exit(1);
  }
}
if (js === before) {
  console.error('No rewrites applied at all; refusing to write a broken embed.');
  process.exit(1);
}

// ---------------------------------------------------------------------------

const out = `/**
 * Greater Life Baptist Church calendar, as an embeddable widget.
 *
 * Two lines put the whole calendar on any page, a WordPress Custom HTML block
 * included:
 *
 *   <div id="glbc-calendar"></div>
 *   <script src="https://calendars.greaterlifebaptistchurch.com/embed.js" defer></` + `script>
 *
 * The address bar keeps the host page's own URL, so the church site can serve
 * this at /calendar while the data, the design and this code all live on the
 * calendar host and update themselves. Nothing to re-paste, ever.
 *
 * GENERATED FILE. Built from site/index.html.
 * Edit that page, then run:  node scripts/build-embed.mjs
 *
 * Everything is scoped under #glbc-calendar, so a WordPress theme cannot bleed
 * into the calendar and the calendar cannot bleed into the page around it.
 */
(function () {
  var HOST = document.getElementById("glbc-calendar");
  if (!HOST) {
    console.warn("[glbc] Nothing to render into. Add <div id=glbc-calendar></div>.");
    return;
  }
  if (HOST.dataset.glbcReady) return;
  HOST.dataset.glbcReady = "1";

  // Wherever this script was served from is where the data lives too.
  var tag = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var BASE = tag ? tag.src.replace(/[/]embed[.]js.*$/, "") : "";

  if (!document.querySelector("link[data-glbc-fonts]")) {
    var fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.setAttribute("data-glbc-fonts", "1");
    fonts.href = "https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700" +
      "&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap";
    document.head.appendChild(fonts);
  }

  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(RESET + '\n' + css)};
  document.head.appendChild(style);

  HOST.innerHTML = ${JSON.stringify(body)}.split("__BASE__").join(BASE);

${js.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n')}
})();
`;

writeFileSync(join(ROOT, 'site', 'embed.js'), out, 'utf8');
console.log('site/embed.js written, ' + out.split('\n').length + ' lines');
