/**
 * Greater Life Baptist Church calendar, as an embeddable widget.
 *
 * Two lines put the whole calendar on any page, a WordPress Custom HTML block
 * included:
 *
 *   <div id="glbc-calendar"></div>
 *   <script src="https://calendars.greaterlifebaptistchurch.com/embed.js" defer></script>
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
  style.textContent = "#glbc-calendar,\n#glbc-calendar *,\n#glbc-calendar *::before,\n#glbc-calendar *::after{\n  box-sizing:border-box;margin:0;padding:0;border:0;outline:0;\n  background:none;box-shadow:none;float:none;position:static;\n  text-transform:none;letter-spacing:normal;text-indent:0;text-align:left;\n  list-style:none;text-decoration:none;font-style:normal;\n  min-width:0;max-width:100%;width:auto;height:auto;\n}\n#glbc-calendar{max-width:100%;overflow-x:clip;isolation:isolate}\n#glbc-calendar img{max-width:100%;height:auto}\n#glbc-calendar{\n  --ivory:#FFFCF4;\n  --card:#FFFFFF;\n  --ink:#241F1B;\n  --ink-soft:#6B625A;\n  --rule:#EBE3D5;\n  --sun:#F0A202;\n  --clay:#D14E2B;\n  --pine:#1B5E45;\n  --plum:#7A3E6E;\n  --display:\"Zilla Slab\",Georgia,serif;\n  --body:\"Public Sans\",system-ui,-apple-system,sans-serif;\n  --mono:\"IBM Plex Mono\",ui-monospace,monospace;\n}\n#glbc-calendar *{box-sizing:border-box}\n/* Author `display` declarations beat the browser's [hidden] rule, so anything\n   toggled by the hidden attribute needs this or it renders as an empty box. */\n#glbc-calendar [hidden]{display:none!important}\n#glbc-calendar{background:var(--ivory);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}\n#glbc-calendar .wrap{max-width:900px;margin:0 auto;padding:0 20px 80px}\n/* ---------- masthead ---------- */\n#glbc-calendar .masthead{padding:34px 0 22px;position:relative}\n#glbc-calendar .ribbon{display:flex;height:6px;border-radius:100px;overflow:hidden;margin-bottom:22px}\n#glbc-calendar .ribbon span{flex:1}\n#glbc-calendar .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--clay);margin:0 0 9px;font-weight:600}\n#glbc-calendar .masthead h1{font-family:var(--display);font-weight:700;font-size:clamp(2.1rem,7.5vw,3.3rem);line-height:1;letter-spacing:-.02em;margin:0;color:var(--pine)}\n#glbc-calendar .masthead h1 em{font-style:normal;color:var(--sun)}\n#glbc-calendar .masthead p{margin:13px 0 0;color:var(--ink-soft);max-width:48ch;font-size:.95rem}\n/* ---------- filters ---------- */\n#glbc-calendar .filters{padding:24px 0 4px;border-top:1px solid var(--rule);margin-top:24px}\n#glbc-calendar .filters-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}\n#glbc-calendar .filters-head h2{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);margin:0;font-weight:600}\n#glbc-calendar .linkbtn{background:none;border:none;padding:0;cursor:pointer;font-family:var(--body);font-size:.82rem;font-weight:600;color:var(--clay);text-decoration:underline;text-underline-offset:3px}\n#glbc-calendar .pills{display:flex;flex-wrap:wrap;gap:8px}\n#glbc-calendar .pill{display:inline-flex;align-items:center;gap:7px;border:1.5px solid var(--rule);background:var(--card);border-radius:100px;padding:7px 15px 7px 11px;cursor:pointer;font-size:.87rem;font-weight:600;color:var(--ink-soft);transition:.14s}\n#glbc-calendar .pill:hover{border-color:currentColor}\n#glbc-calendar .pill input{position:absolute;opacity:0;width:0;height:0}\n#glbc-calendar .dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;opacity:.3;transition:opacity .14s}\n#glbc-calendar .pill.on .dot{opacity:1}\n#glbc-calendar .pill input:focus-visible + .dot{outline:2px solid var(--sun);outline-offset:3px}\n/* ---------- tabs ---------- */\n#glbc-calendar .views{display:flex;margin:28px 0 4px;border-bottom:2px solid var(--rule)}\n#glbc-calendar .tab{background:none;border:none;cursor:pointer;padding:9px 2px;margin-right:28px;font-family:var(--display);font-size:1.08rem;font-weight:600;color:var(--ink-soft);border-bottom:3px solid transparent;margin-bottom:-2px}\n#glbc-calendar .tab[aria-selected=\"true\"]{color:var(--pine);border-bottom-color:var(--sun)}\n#glbc-calendar .tab:focus-visible{outline:2px solid var(--sun);outline-offset:2px}\n/* ---------- pinned ---------- */\n#glbc-calendar .pinned{margin-top:26px;background:linear-gradient(180deg,#FFF6E0 0%,#FFFCF4 100%);border:1.5px solid #F2DFAE;border-radius:11px;padding:16px 17px 6px}\n#glbc-calendar .pinned-head{display:flex;align-items:center;gap:8px;margin-bottom:13px}\n#glbc-calendar .pinned-head h2{font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;margin:0;color:#8A6A08;font-weight:600}\n#glbc-calendar .pinned-head .sub{font-size:.8rem;color:var(--ink-soft);margin-left:auto}\n#glbc-calendar .pinrow{display:flex;gap:14px;align-items:flex-start;padding-bottom:14px;margin-bottom:2px;border-bottom:1px dashed #F0DEB4}\n#glbc-calendar .pinned .pinrow:last-child{border-bottom:none;padding-bottom:12px}\n#glbc-calendar .pinrow .when{flex:0 0 66px;font-family:var(--mono);font-size:11.5px;font-weight:600;line-height:1.35;color:var(--ink-soft);padding-top:2px}\n#glbc-calendar .pinrow .when b{display:block;font-family:var(--display);font-size:1.05rem;color:var(--ink)}\n#glbc-calendar .pinrow .body h3{font-family:var(--display);font-size:1.06rem;margin:0 0 2px;line-height:1.25}\n#glbc-calendar .pinrow .body .meta{font-size:.81rem;color:var(--ink-soft)}\n#glbc-calendar .away{display:inline-block;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;background:var(--sun);color:#3D2A00;padding:2px 7px;border-radius:4px;margin-top:6px}\n/* ---------- agenda ---------- */\n#glbc-calendar .agenda{margin-top:26px}\n#glbc-calendar .month-head{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--clay);font-weight:600;margin:32px 0 14px;padding-bottom:7px;border-bottom:2px solid var(--rule)}\n#glbc-calendar .month-head:first-child{margin-top:0}\n#glbc-calendar .entry{display:flex;gap:15px;margin-bottom:13px;align-items:flex-start}\n#glbc-calendar .datechip{flex:0 0 60px;text-align:center;padding:8px 0 9px;border-radius:9px;color:#fff}\n#glbc-calendar .datechip .dow{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.82;display:block}\n#glbc-calendar .datechip .dnum{font-family:var(--display);font-size:1.55rem;font-weight:700;line-height:1.05;display:block}\n#glbc-calendar .card{flex:1;background:var(--card);border:1.5px solid var(--rule);border-radius:9px;padding:13px 16px;min-width:0}\n#glbc-calendar .card h3{font-family:var(--display);font-size:1.16rem;font-weight:600;margin:0 0 3px;line-height:1.24}\n#glbc-calendar .meta{font-size:.83rem;color:var(--ink-soft);display:flex;flex-wrap:wrap;gap:4px 13px;margin-top:5px}\n#glbc-calendar .meta .who{font-weight:700}\n#glbc-calendar .card p.note{margin:8px 0 0;font-size:.88rem;color:var(--ink-soft)}\n#glbc-calendar .card a.cta{display:inline-block;margin-top:9px;font-size:.85rem;font-weight:700;color:var(--clay);text-decoration:underline;text-underline-offset:3px}\n#glbc-calendar .pinmark{float:right;font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#8A6A08;background:#FFF1CE;padding:2px 7px;border-radius:4px;margin-left:8px}\n#glbc-calendar .entry.deadline .datechip{background:var(--clay)!important}\n#glbc-calendar .entry.deadline .card{background:#FFF6F2;border-color:#F3D3C6}\n#glbc-calendar .due{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--clay);margin-bottom:5px}\n#glbc-calendar .due::before{content:\"\";width:5px;height:5px;border-radius:50%;background:var(--clay)}\n#glbc-calendar .morebtn{width:100%;margin-top:20px;padding:13px;background:var(--card);border:1.5px dashed var(--rule);border-radius:9px;cursor:pointer;font-family:var(--body);font-size:.88rem;font-weight:600;color:var(--ink-soft)}\n#glbc-calendar .morebtn:hover{border-color:var(--sun);color:var(--pine)}\n#glbc-calendar .empty{text-align:center;padding:52px 20px;color:var(--ink-soft);border:1.5px dashed var(--rule);border-radius:11px;margin-top:26px}\n#glbc-calendar .empty strong{display:block;font-family:var(--display);font-size:1.2rem;color:var(--ink);margin-bottom:6px}\n/* ---------- month grid ---------- */\n#glbc-calendar .gridnav{display:flex;align-items:center;gap:12px;margin:26px 0 14px}\n#glbc-calendar .gridnav h3{font-family:var(--display);font-size:1.4rem;margin:0;color:var(--pine);flex:1}\n#glbc-calendar .navbtn{background:var(--card);border:1.5px solid var(--rule);border-radius:7px;width:36px;height:36px;cursor:pointer;color:var(--pine);font-size:1.1rem}\n#glbc-calendar .navbtn:hover{border-color:var(--sun)}\n#glbc-calendar .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--rule);border:1.5px solid var(--rule);border-radius:10px;overflow:hidden}\n#glbc-calendar .gh{background:var(--ivory);padding:8px 4px;text-align:center;font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-soft)}\n#glbc-calendar .gd{background:var(--card);min-height:80px;padding:5px}\n#glbc-calendar .gd.off{background:#FDFAF2}\n#glbc-calendar .gd .n{font-family:var(--mono);font-size:11px;color:var(--ink-soft);display:block;margin-bottom:3px}\n#glbc-calendar .gd.today .n{background:var(--sun);color:#3D2A00;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-weight:600}\n#glbc-calendar .ev{font-size:10.5px;line-height:1.28;padding:2px 5px;border-radius:4px;margin-bottom:2px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}\n#glbc-calendar .ev.dl{background:var(--clay)!important;font-weight:700}\n/* ---------- subscribe ---------- */\n#glbc-calendar .subscribe{margin-top:32px;background:var(--pine);border-radius:11px;padding:15px 17px 14px;color:#EAF3EE}\n#glbc-calendar .subscribe h2{font-family:var(--display);font-size:1.12rem;margin:0 0 9px;color:#fff}\n/* Says exactly what the buttons will add, because the ministry filter above\n   drives it and that connection is not obvious from the buttons alone. */\n#glbc-calendar .subwhat{margin:0 0 11px;font-size:.85rem;line-height:1.45;color:#EAF3EE;background:rgba(0,0,0,.16);border-left:3px solid var(--sun);border-radius:0 6px 6px 0;padding:8px 11px}\n#glbc-calendar .subwhat b{color:#fff}\n#glbc-calendar .subwhat.none{border-left-color:#8FB3A2;color:#B9D2C6}\n#glbc-calendar .btns{display:flex;flex-wrap:wrap;gap:7px}\n#glbc-calendar .btn{display:inline-block;padding:8px 14px;border-radius:7px;font-size:.82rem;font-weight:700;text-decoration:none;background:var(--sun);color:#3D2A00}\n#glbc-calendar .btn.ghost{background:transparent;border:1.5px solid #47806A;color:#EAF3EE}\n#glbc-calendar .btn:hover{opacity:.9}\n#glbc-calendar .btn.off{opacity:.35;pointer-events:none;cursor:default}\n#glbc-calendar .fineprint{margin-top:11px;margin-bottom:0;font-size:.76rem;line-height:1.45;color:#8FB3A2}\n/* The second way of getting a calendar. It used to be a link in the footer,\n   which read as an afterthought, so nobody could tell it existed or how it\n   differed from the buttons above. */\n#glbc-calendar .getown{margin-top:14px;background:var(--card);border:2px solid var(--pine);border-radius:11px;padding:15px 17px}\n#glbc-calendar .getown h2{font-family:var(--display);font-size:1.12rem;margin:0 0 6px;color:var(--pine)}\n#glbc-calendar .getown p{margin:0 0 12px;font-size:.86rem;line-height:1.5;color:var(--ink-soft);max-width:56ch}\n#glbc-calendar .getown ul{margin:0 0 13px;padding-left:19px;font-size:.85rem;line-height:1.5;color:var(--ink-soft)}\n#glbc-calendar .getown li{margin-bottom:3px}\n#glbc-calendar .getown li b{color:var(--ink)}\n#glbc-calendar .getown .btn{background:var(--pine);color:#fff;font-size:.88rem;padding:11px 18px}\n#glbc-calendar footer{margin-top:34px;font-size:.82rem;color:var(--ink-soft)}\n#glbc-calendar footer .footlinks{margin:9px 0 0;display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}\n#glbc-calendar footer .footlinks a{color:var(--clay);font-weight:600;text-decoration:underline;text-underline-offset:3px}\n#glbc-calendar footer .footlinks span{opacity:.5}\n#glbc-calendar footer .stamp{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em}\n@media(max-width:560px){\n  .datechip{flex-basis:50px}\n  .gd{min-height:56px}\n  .ev{font-size:0;padding:0;height:5px;margin-bottom:2px;border-radius:2px}\n  .pinrow .when{flex-basis:56px}\n}\n@media(prefers-reduced-motion:no-preference){\n  .entry{animation:rise .32s ease both}\n  @keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}\n}\n/* ---------- staleness notice ---------- */\n#glbc-calendar .notice{display:flex;gap:11px;align-items:flex-start;margin-top:20px;padding:12px 15px;border-radius:9px;font-size:.86rem;background:#FFF6E0;border:1.5px solid #F2DFAE;color:#6B5307}\n#glbc-calendar .notice.warn{background:#FFF6F2;border-color:#F3D3C6;color:#8C2F10}\n#glbc-calendar .notice b{display:block;font-family:var(--display);font-size:.98rem;margin-bottom:1px}\n#glbc-calendar .notice .ico{flex:0 0 auto;font-size:1.05rem;line-height:1.35}\n/* ---------- add to home screen ---------- */\n#glbc-calendar .install{position:fixed;left:12px;right:12px;bottom:12px;z-index:20;display:flex;gap:12px;align-items:center;background:var(--card);border:1.5px solid var(--rule);border-radius:12px;padding:13px 14px;box-shadow:0 8px 28px rgba(36,31,27,.16);max-width:520px;margin:0 auto}\n#glbc-calendar .install .ico{flex:0 0 34px;height:34px;border-radius:8px;background:var(--pine);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.05rem}\n#glbc-calendar .install .txt{flex:1;min-width:0;font-size:.85rem;line-height:1.4;color:var(--ink-soft)}\n#glbc-calendar .install .txt b{display:block;color:var(--ink);font-family:var(--display);font-size:1rem}\n#glbc-calendar .install button{flex:0 0 auto;border:none;border-radius:7px;padding:8px 13px;font-family:var(--body);font-size:.83rem;font-weight:700;cursor:pointer;background:var(--sun);color:#3D2A00}\n#glbc-calendar .install button.dismiss{background:none;color:var(--ink-soft);padding:8px 6px;text-decoration:underline;text-underline-offset:3px}\n/* ---------- TV mode ----------\n   Wall-mounted tablets replacing the paper calendar cards. No interaction,\n   no filters, no month grid. Read from across the fellowship hall. */\n#glbc-calendar.tv{font-size:24px}\n#glbc-calendar.tv .wrap{max-width:1500px;padding:0 40px 40px}\n#glbc-calendar.tv .filters,#glbc-calendar.tv .views,#glbc-calendar.tv .subscribe,#glbc-calendar.tv #monthView,#glbc-calendar.tv .morebtn,#glbc-calendar.tv .install,#glbc-calendar.tv .footlinks{display:none!important}\n#glbc-calendar.tv .masthead{padding:30px 0 14px}\n#glbc-calendar.tv .masthead h1{font-size:clamp(2.6rem,5vw,4rem)}\n#glbc-calendar.tv .masthead p{display:none}\n#glbc-calendar.tv .eyebrow{font-size:16px}\n#glbc-calendar.tv .tvclock{font-family:var(--mono);font-size:19px;letter-spacing:.05em;color:var(--ink-soft);position:absolute;right:0;top:44px;text-align:right}\n#glbc-calendar.tv .agenda{margin-top:14px}\n#glbc-calendar.tv .month-head{font-size:17px;margin:26px 0 14px}\n#glbc-calendar.tv .entry{margin-bottom:16px;gap:20px}\n#glbc-calendar.tv .datechip{flex-basis:104px;padding:12px 0 13px;border-radius:12px}\n#glbc-calendar.tv .datechip .dow{font-size:14px}\n#glbc-calendar.tv .datechip .dnum{font-size:2.7rem}\n#glbc-calendar.tv .card{padding:18px 22px;border-radius:12px;border-width:2px}\n#glbc-calendar.tv .card h3{font-size:1.75rem}\n#glbc-calendar.tv .meta{font-size:1.05rem;gap:6px 20px}\n#glbc-calendar.tv .card p.note{font-size:1.05rem}\n#glbc-calendar.tv .due{font-size:15px}\n#glbc-calendar.tv .pinned{padding:20px 22px 10px}\n#glbc-calendar.tv .pinned-head h2,#glbc-calendar.tv .pinned-head .sub{font-size:16px}\n#glbc-calendar.tv .pinrow .body h3{font-size:1.45rem}\n#glbc-calendar.tv .pinrow .when{flex-basis:104px;font-size:16px}\n#glbc-calendar.tv .pinrow .when b{font-size:1.7rem}\n#glbc-calendar.tv .pinrow .body .meta,#glbc-calendar.tv .away{font-size:1rem}\n#glbc-calendar.tv .notice{font-size:1.1rem}\n#glbc-calendar.tv footer{font-size:1rem}\n/* Two columns once the screen is wide enough to want them. */\n@media(min-width:1200px){\n  body.tv .agenda{column-count:2;column-gap:44px}\n  body.tv .entry,body.tv .month-head{break-inside:avoid}\n  body.tv .month-head{column-span:all}\n}";
  document.head.appendChild(style);

  HOST.innerHTML = "<div class=\"wrap\">\n\n<header class=\"masthead\">\n  <div class=\"ribbon\" id=\"ribbon\"></div>\n  <p class=\"eyebrow\">Greater Life Baptist Church · Midland, Georgia</p>\n  <h1>What's <em>Coming Up</em></h1>\n  <p>Services Thursday at 7 PM and Sunday at 11 AM. Everything else — trips, revivals, fundraisers, and due dates — is below.</p>\n  <div class=\"tvclock\" id=\"tvclock\" hidden></div>\n</header>\n\n<div class=\"notice\" id=\"notice\" hidden></div>\n\n<section class=\"filters\">\n  <div class=\"filters-head\">\n    <h2>Show me</h2>\n    <button class=\"linkbtn\" id=\"toggleAll\" type=\"button\">Select all</button>\n  </div>\n  <div class=\"pills\" id=\"pills\"></div>\n</section>\n\n<div class=\"views\" role=\"tablist\">\n  <button class=\"tab\" role=\"tab\" aria-selected=\"true\" data-view=\"agenda\">Coming up</button>\n  <button class=\"tab\" role=\"tab\" aria-selected=\"false\" data-view=\"month\">Month</button>\n</div>\n\n<div id=\"agendaView\">\n  <section class=\"pinned\" id=\"pinned\" hidden></section>\n  <div class=\"agenda\" id=\"agenda\"></div>\n  <button class=\"morebtn\" id=\"moreBtn\" type=\"button\" hidden></button>\n</div>\n\n<div id=\"monthView\" hidden>\n  <div class=\"gridnav\">\n    <h3 id=\"gridLabel\"></h3>\n    <button class=\"navbtn\" id=\"prevM\" type=\"button\" aria-label=\"Previous month\">&lsaquo;</button>\n    <button class=\"navbtn\" id=\"nextM\" type=\"button\" aria-label=\"Next month\">&rsaquo;</button>\n  </div>\n  <div class=\"grid\" id=\"grid\"></div>\n</div>\n\n<section class=\"subscribe\">\n  <h2>Put this on your phone</h2>\n  <p class=\"subwhat\" id=\"subWhat\"></p>\n  <div class=\"btns\">\n    <a class=\"btn\" href=\"#\" id=\"btnApple\">Apple Calendar</a>\n    <a class=\"btn ghost\" href=\"#\" id=\"btnGoogle\">Google Calendar</a>\n    <a class=\"btn ghost\" href=\"#\" id=\"btnIcs\">Outlook or other</a>\n  </div>\n  <p class=\"fineprint\">Nothing is recorded and nothing is installed: the events appear in the calendar app you already use, and refresh on its own schedule, so they can run a few hours behind. Changing your mind later arrives as a second calendar rather than replacing the first, so remove the old one if you swap.</p>\n</section>\n\n<section class=\"getown\">\n  <h2>Or get your own calendar</h2>\n  <p>Same events, but the church knows it is yours. Worth the extra minute if any of these matter:</p>\n  <ul>\n    <li><b>You are on Android.</b> The buttons above cannot finish on an Android phone — the Google Calendar app has no way to add a calendar from a link. Signing up puts the calendars straight into your Google account instead.</li>\n    <li><b>You want to change it later</b> without starting again.</li>\n    <li><b>A leader needs to add you</b> to a group that is not listed here.</li>\n  </ul>\n  <a class=\"btn\" href=\"__BASE__/signup\">Get your own calendar</a>\n</section>\n\n<footer>\n  <p class=\"stamp\" id=\"stamp\"></p>\n  <p class=\"footlinks\">\n    <a href=\"__BASE__/admin\" rel=\"nofollow\">Leaders</a>\n  </p>\n</footer>\n\n</div>\n\n<div class=\"install\" id=\"install\" hidden>\n  <span class=\"ico\">＋</span>\n  <span class=\"txt\" id=\"installTxt\"></span>\n  <button type=\"button\" id=\"installGo\" hidden>Add</button>\n  <button type=\"button\" class=\"dismiss\" id=\"installNo\">Not now</button>\n</div>".split("__BASE__").join(BASE);


  /* Last-resort sample, used only when events.json cannot be reached AND no
     previously fetched copy is cached on this device. Ministry ids match
     job/config/ministries.json; they are locked and appear in feed URLs. The
     page marks this data as an example so nobody turns up to an event that was
     never scheduled. */
  const SAMPLE = {
    generated: "2026-08-24T19:00:00-04:00",
    sample: true,
    feeds: {
      base: "https://calendars.greaterlifebaptistchurch.com/feeds/",
      all:  "all.ics"
    },
    ministries: [
      { id:"church", name:"Church-wide",        color:"#1B5E45" },
      { id:"youth",  name:"Greater Generation", color:"#6B9A12" }
    ],
    events: [
      { uid:"e1", ministry:"youth", type:"deadline", pinned:true,
        title:"Permission forms due — Pigeon Forge", start:"2026-08-30", allDay:true,
        notes:"Signed form and medical release. No form, no seat on the van.",
        link:"#", linkText:"Open the permission form" },
      { uid:"e2", ministry:"church", type:"service", title:"Revival — Night 1",
        start:"2026-09-06T19:00:00", end:"2026-09-06T20:30:00", location:"Sanctuary",
        notes:"Preaching: Bro. Daniel Hicks. Special singing before the message." },
      { uid:"e3", ministry:"church", type:"service", title:"Revival — Night 2 (Youth Night)",
        start:"2026-09-07T19:00:00", end:"2026-09-07T20:30:00", location:"Sanctuary",
        notes:"Teens sit together up front. Pizza in the fellowship hall afterward." },
      { uid:"e4", ministry:"church", type:"service", title:"Revival — Night 3",
        start:"2026-09-08T19:00:00", end:"2026-09-08T20:30:00", location:"Sanctuary" },
      { uid:"e5", ministry:"church", type:"event", title:"Men's breakfast",
        start:"2026-09-12T07:30:00", end:"2026-09-12T09:00:00", location:"Fellowship hall",
        notes:"Bring a friend. Eggs and grits on the house." },
      { uid:"e6", ministry:"youth", type:"deadline", title:"Raffle money & unsold tickets due",
        start:"2026-09-13", allDay:true,
        notes:"Turn in to Bro. Spencer. Everything comes back, sold or not." },
      { uid:"e7", ministry:"church", type:"event", title:"Fall Festival planning meeting",
        start:"2026-09-15T18:30:00", end:"2026-09-15T19:30:00", location:"Kids room" },
      { uid:"e8", ministry:"church", type:"event", title:"Ladies' fellowship supper",
        start:"2026-09-19T18:00:00", end:"2026-09-19T20:00:00", location:"Fellowship hall",
        notes:"Covered dish — bring a side or dessert." },
      { uid:"e9", ministry:"youth", type:"event", title:"Gun raffle drawing",
        start:"2026-09-20T12:30:00", end:"2026-09-20T13:00:00", location:"Fellowship hall",
        notes:"Right after morning service. Winner's choice of the three prizes." },
      { uid:"e10", ministry:"church", type:"event", title:"Fifth Sunday singing & dinner on the grounds",
        start:"2026-09-27T11:00:00", end:"2026-09-27T14:00:00", location:"Pavilion" },
      { uid:"e11", ministry:"church", type:"event", title:"Fall Festival",
        start:"2026-10-31T17:00:00", end:"2026-10-31T20:00:00", location:"Church grounds",
        notes:"Trunk-or-treat, cake walk, hayride." },
      { uid:"e12", ministry:"youth", type:"deadline", pinned:true,
        title:"Trip deposit due — $75", start:"2027-02-14", allDay:true,
        notes:"Non-refundable. Locks in your spot and the group rate on cabins." },
      { uid:"e13", ministry:"youth", type:"trip", pinned:true,
        title:"Youth trip — Pigeon Forge, TN", start:"2027-07-12", end:"2027-07-17", allDay:true,
        location:"Pigeon Forge, Tennessee",
        notes:"Six days. Dollywood, Ober Mountain, and evening services at the cabin." },
      { uid:"e14", ministry:"church", type:"event", pinned:true, title:"Homecoming",
        start:"2027-05-16T10:00:00", end:"2027-05-16T14:00:00", location:"Church grounds",
        notes:"Dinner on the grounds and afternoon singing. Invite family early — folks travel in." }
    ]
  };

  let DATA = SAMPLE, active = new Set(), showAll = false;
  let cursor = new Date(); cursor.setDate(1);

  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const $ = id => HOST.querySelector("#" + id);
  const parse = s => new Date(s.length === 10 ? s + "T00:00:00" : s);
  const min = m => DATA.ministries.find(x => x.id === m) || { name:m, color:"#6B625A" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  function startOfToday(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
  function daysUntil(d){ return Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate()) - startOfToday())/86400000); }
  function windowEnd(){ const t = startOfToday(); return new Date(t.getFullYear(), t.getMonth()+2, 0, 23, 59, 59); }

  function countdown(n){
    if (n < 0)   return "Past due";
    if (n === 0) return "Due today";
    if (n === 1) return "Due tomorrow";
    if (n < 45)  return "Due in " + n + " days";
    return "Due in " + Math.round(n/30) + " months";
  }
  function awayLabel(n){
    if (n <= 0)  return "Happening now";
    if (n < 45)  return n + " days away";
    if (n < 365) return Math.round(n/30) + " months away";
    return "Next year";
  }
  function timeLabel(e){
    if (e.allDay){
      if (!e.end) return "All day";
      const s = parse(e.start), en = parse(e.end);
      return MONS[s.getMonth()] + " " + s.getDate() + " – " + MONS[en.getMonth()] + " " + en.getDate();
    }
    const t = d => d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}).replace(":00","");
    return e.end ? t(parse(e.start)) + " – " + t(parse(e.end)) : t(parse(e.start));
  }

  function buildPills(){
    const box = $("pills"); box.innerHTML = "";
    DATA.ministries.forEach(m => {
      const on = active.has(m.id);
      const label = document.createElement("label");
      label.className = "pill" + (on ? " on" : "");
      if (on){ label.style.background = m.color; label.style.borderColor = m.color; label.style.color = "#fff"; }
      label.innerHTML = '<input type="checkbox" ' + (on ? "checked" : "") + '>' +
        '<span class="dot" style="background:' + (on ? "#fff" : m.color) + '"></span><span>' + esc(m.name) + '</span>';
      label.querySelector("input").addEventListener("change", () => {
        active.has(m.id) ? active.delete(m.id) : active.add(m.id);
        buildPills(); render();
      });
      box.appendChild(label);
    });
  }

  function buildRibbon(){
    $("ribbon").innerHTML = DATA.ministries
      .map(m => '<span style="background:' + m.color + '"></span>').join("");
  }

  function upcoming(){
    const today = startOfToday();
    return DATA.events
      .filter(e => active.has(e.ministry))
      .filter(e => parse(e.end || e.start) >= today)
      .sort((a,b) => parse(a.start) - parse(b.start));
  }

  function renderPinned(){
    const host = $("pinned");
    const cut = windowEnd();
    const list = upcoming().filter(e => e.pinned && parse(e.start) > cut);
    if (!list.length){ host.hidden = true; return; }
    host.hidden = false;

    host.innerHTML = '<div class="pinned-head"><h2>Pinned — plan ahead</h2>' +
      '<span class="sub">' + list.length + ' further out</span></div>' +
      list.map(e => {
        const d = parse(e.start), m = min(e.ministry), n = daysUntil(d);
        return '<div class="pinrow"><div class="when">' + MONS[d.getMonth()].toUpperCase() +
          '<b>' + d.getDate() + '</b>' + d.getFullYear() + '</div><div class="body">' +
          '<h3>' + esc(e.title) + '</h3><div class="meta"><span style="color:' + m.color +
          ';font-weight:700">' + esc(m.name) + '</span> · ' + timeLabel(e) +
          (e.location ? " · " + esc(e.location) : "") + '</div>' +
          (e.notes ? '<div class="meta">' + esc(e.notes) + '</div>' : "") +
          '<span class="away">' + (e.type === "deadline" ? countdown(n) : awayLabel(n)) + '</span>' +
          '</div></div>';
      }).join("");
  }

  function renderAgenda(){
    const host = $("agenda"), btn = $("moreBtn");
    const all = upcoming(), cut = windowEnd();
    const near = all.filter(e => parse(e.start) <= cut);
    const later = all.filter(e => parse(e.start) > cut);
    const list = showAll ? all : near;
    host.innerHTML = "";

    if (!list.length){
      // A ministry only appears once it has something on it, so when none do
      // there is nothing above to turn on and saying so would just confuse.
      host.innerHTML = DATA.ministries.length
        ? '<div class="empty"><strong>Nothing scheduled here yet</strong>' +
          'Turn on another ministry above, or check back after Sunday.</div>'
        : '<div class="empty"><strong>Nothing on the calendar yet</strong>' +
          'Events will show up here as soon as they are scheduled.</div>';
      btn.hidden = !later.length;
      if (later.length) btn.textContent = "Show " + later.length + " event" + (later.length>1?"s":"") + " further out";
      return;
    }

    let lastMonth = "";
    list.forEach(e => {
      const d = parse(e.start), m = min(e.ministry), dl = e.type === "deadline";
      const key = MON[d.getMonth()] + " " + d.getFullYear();
      if (key !== lastMonth){
        const h = document.createElement("div");
        h.className = "month-head"; h.textContent = key;
        host.appendChild(h); lastMonth = key;
      }
      const row = document.createElement("article");
      row.className = "entry" + (dl ? " deadline" : "");
      row.innerHTML =
        '<div class="datechip" style="background:' + m.color + '"><span class="dow">' + DOW[d.getDay()] +
        '</span><span class="dnum">' + d.getDate() + '</span></div><div class="card">' +
        (e.pinned ? '<span class="pinmark">Pinned</span>' : "") +
        (dl ? '<span class="due">' + countdown(daysUntil(d)) + '</span>' : "") +
        '<h3>' + esc(e.title) + '</h3><div class="meta">' +
        '<span class="who" style="color:' + (dl ? "#D14E2B" : m.color) + '">' + esc(m.name) + '</span>' +
        '<span>' + timeLabel(e) + '</span>' +
        (e.location ? '<span>' + esc(e.location) + '</span>' : "") + '</div>' +
        (e.notes ? '<p class="note">' + esc(e.notes) + '</p>' : "") +
        (e.link ? '<a class="cta" href="' + esc(e.link) + '">' + esc(e.linkText || "Details") + ' &rarr;</a>' : "") +
        '</div>';
      host.appendChild(row);
    });

    btn.hidden = !later.length;
    btn.textContent = showAll
      ? "Show less"
      : "Show " + later.length + " event" + (later.length>1?"s":"") + " further out";
  }

  function renderGrid(){
    const g = $("grid"); g.innerHTML = "";
    const y = cursor.getFullYear(), mo = cursor.getMonth();
    $("gridLabel").textContent = MON[mo] + " " + y;
    DOW.forEach(d => { const h = document.createElement("div"); h.className = "gh"; h.textContent = d; g.appendChild(h); });

    const first = new Date(y,mo,1).getDay(), days = new Date(y,mo+1,0).getDate(), prev = new Date(y,mo,0).getDate();
    const today = startOfToday();

    for (let i = 0; i < 42; i++){
      const cell = document.createElement("div");
      let n, inMonth = true;
      if (i < first){ n = prev - first + 1 + i; inMonth = false; }
      else if (i - first < days){ n = i - first + 1; }
      else { n = i - first - days + 1; inMonth = false; }
      cell.className = "gd" + (inMonth ? "" : " off");
      cell.innerHTML = '<span class="n">' + n + '</span>';

      if (inMonth){
        const date = new Date(y,mo,n);
        if (date.getTime() === today.getTime()) cell.classList.add("today");
        DATA.events
          .filter(e => active.has(e.ministry))
          .filter(e => {
            const s = parse(e.start), en = parse(e.end || e.start);
            return date >= new Date(s.getFullYear(),s.getMonth(),s.getDate())
                && date <= new Date(en.getFullYear(),en.getMonth(),en.getDate());
          })
          .forEach(e => {
            const chip = document.createElement("div");
            chip.className = "ev" + (e.type === "deadline" ? " dl" : "");
            chip.style.background = min(e.ministry).color;
            chip.textContent = e.title; chip.title = e.title;
            cell.appendChild(chip);
          });
      }
      g.appendChild(cell);
    }
  }

  function renderSubscribe(){
    const sel = [...active];
    const total = DATA.ministries.length;
    const btns = ["btnApple","btnGoogle","btnIcs"].map($);
    const box = $("subWhat");

    // Nothing selected means nothing to add. Falling back to everything would
    // hand someone the opposite of what they asked for; if they wanted all of
    // it they would have selected all of it.
    if (!sel.length){
      btns.forEach(b => {
        b.classList.add("off");
        b.setAttribute("aria-disabled","true");
        b.removeAttribute("href");
      });
      box.className = "subwhat none";
      box.innerHTML = "Pick at least one calendar under <b>Show me</b> above, and these buttons will add exactly that.";
      return;
    }

    // A feed exists for every combination of ministries, built ahead of time, so
    // the buttons can now add exactly what is ticked. They used to fall back to
    // the everything feed for any partial selection and say so, which was honest
    // but still the wrong calendar, and it named the download "all.ics" when it
    // was not all of anything.
    const single = sel.length === 1;
    const everything = sel.length === total;
    const combo = DATA.feeds?.combo;
    const url = combo
      ? combo + [...sel].sort().join("-") + ".ics"
      : (DATA.feeds?.base || "") + (single ? sel[0] + ".ics" : (DATA.feeds?.all || "all.ics"));

    btns.forEach(b => { b.classList.remove("off"); b.removeAttribute("aria-disabled"); });

    // Neither link route finishes on an Android phone: the Google Calendar app
    // has no way to add a calendar from a URL, so tapping either opens an app
    // that then does nothing. Naming a button after the platform it cannot serve
    // was worse still, which is why they are named after the app they open.
    const onAndroid = /Android/i.test(navigator.userAgent);
    $("btnApple").hidden = onAndroid;
    $("btnGoogle").hidden = onAndroid;

    $("btnApple").href  = url.replace(/^https?:/, "webcal:");
    // Google's add-by-URL wants the webcal form. Handed an https one it opens
    // the page and says "Unable to add the calendar, check the URL".
    $("btnGoogle").href = "https://calendar.google.com/calendar/render?cid=" +
      encodeURIComponent(url.replace(/^https?:/, "webcal:"));
    $("btnIcs").href    = url;

    const names = sel.map(id => esc(min(id).name));
    box.className = "subwhat";
    if (single) box.innerHTML = "Adds <b>" + names[0] + "</b>.";
    else if (everything) box.innerHTML = "Adds <b>everything</b>, all " + total + " calendars.";
    else box.innerHTML = "Adds <b>" + names.slice(0, -1).join(", ") + " and " +
      names[names.length - 1] + "</b> — just those, as one calendar.";
  }

  function render(){
    renderPinned(); renderAgenda(); renderGrid(); renderSubscribe();
    $("toggleAll").textContent = active.size === DATA.ministries.length ? "Clear all" : "Select all";
  }

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected","false"));
      tab.setAttribute("aria-selected","true");
      const month = tab.dataset.view === "month";
      $("monthView").hidden = !month; $("agendaView").hidden = month;
    });
  });
  $("toggleAll").addEventListener("click", () => {
    active = active.size === DATA.ministries.length ? new Set() : new Set(DATA.ministries.map(m => m.id));
    buildPills(); render();
  });
  $("moreBtn").addEventListener("click", () => { showAll = !showAll; renderAgenda(); });
  $("prevM").addEventListener("click", () => { cursor.setMonth(cursor.getMonth()-1); renderGrid(); });
  $("nextM").addEventListener("click", () => { cursor.setMonth(cursor.getMonth()+1); renderGrid(); });

  /* ---------------------------------------------------------------------------
     Data loading.

     The page must never go blank, but it must also never present made-up events
     as real. Someone turning up to a revival that was never scheduled is worse
     than an error message. So: live data if we can get it, otherwise the last
     copy this device successfully fetched, clearly labelled and dated, and only
     as a last resort the built-in example, labelled as an example.
  --------------------------------------------------------------------------- */
  const PARAMS = new URLSearchParams(location.search);
  const TV = (PARAMS.get("display") || "").toLowerCase() === "tv";
  // The wall display is its own page now, built for an 85 inch screen rather
  // than the tablet this mode assumed. Keep the old address working.

  const CACHE_KEY = "glbc.events.v1";
  const DISMISS_KEY = "glbc.install.dismissed";
  const REFRESH_MS = 15 * 60 * 1000;
  /* Feeds are rebuilt hourly, but the schedule genuinely does not move much,
     so a short window would cry wolf. A full day without a refresh does mean
     something upstream has stopped. */
  const STALE_MS = 24 * 60 * 60 * 1000;

  let SOURCE = "sample";

  function readCache(){
    try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  function writeCache(json){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch {}
  }

  function looksValid(j){
    // Deliberately does NOT require any ministries. Once unused ones are hidden,
    // a quiet week legitimately lists none, and treating that as corrupt made the
    // page fall through to the built-in sample and show invented events under an
    // "Example schedule" banner. An empty calendar is an answer, not a failure.
    return j && Array.isArray(j.events) && Array.isArray(j.ministries);
  }

  const longWhen = d => d.toLocaleString("en-US",
    { weekday:"long", month:"long", day:"numeric", hour:"numeric", minute:"2-digit" });

  function renderNotice(){
    const el = $("notice");
    const generated = DATA.generated ? parse(DATA.generated) : null;
    const age = generated ? Date.now() - generated.getTime() : Infinity;

    let cls = null, head = "", body = "";
    if (SOURCE === "sample") {
      cls = "notice warn";
      head = "Example schedule";
      body = "The live calendar could not be loaded and this device has no saved copy, " +
             "so what follows is an example rather than the real schedule. " +
             "Please call the church office.";
    } else if (SOURCE === "cache") {
      cls = "notice";
      head = "Showing a saved copy";
      body = "We could not reach the church calendar just now. This is the schedule as it " +
             "stood on " + longWhen(generated) + ". Refresh once you have a signal.";
    } else if (age > STALE_MS) {
      cls = "notice";
      head = "This may be out of date";
      body = "The calendar refreshes through the day, but it has not since " +
             longWhen(generated) + ". Check with the church office before relying on a date here.";
    }

    if (!cls) { el.hidden = true; return; }
    el.hidden = false;
    el.className = cls;
    el.innerHTML = '<span class="ico">!</span><span><b>' + esc(head) + '</b>' + esc(body) + '</span>';
  }

  function applyData(json, source){
    DATA = json;
    SOURCE = source;

    const ids = DATA.ministries.map(m => m.id);
    const want = PARAMS.get("ministry");
    const picked = want
      ? new Set(want.split(",").map(s => s.trim()).filter(id => ids.includes(id)))
      : new Set(ids);
    active = picked.size ? picked : new Set(ids);

    $("stamp").textContent = DATA.generated
      ? "Last updated " + longWhen(parse(DATA.generated))
      : "";

    buildRibbon(); buildPills(); render(); renderNotice();
  }

  async function fetchEvents(){
    // Cache-bust so a wall tablet that has been on for a month still sees today.
    const res = await fetch(BASE + "/events.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!looksValid(json)) throw new Error("events.json is not shaped as expected");
    return json;
  }

  async function load(){
    try {
      const json = await fetchEvents();
      writeCache(json);
      applyData(json, "live");
    } catch (err) {
      const cached = readCache();
      if (looksValid(cached)) applyData(cached, "cache");
      else applyData(SAMPLE, "sample");
    }
  }

  /* ---------- TV mode: wall tablets replacing the paper calendar cards ------- */

  function startTv(){
    HOST.classList.add("tv");
    $("tvclock").hidden = false;

    const tick = () => {
      $("tvclock").textContent = new Date().toLocaleString("en-US",
        { weekday:"long", month:"long", day:"numeric", hour:"numeric", minute:"2-digit" });
    };
    tick();
    setInterval(tick, 30000);

    // Re-fetch rather than reload: a reload on a cheap tablet risks coming back
    // to a blank page if the network is down at that moment, and the cache path
    // above already handles a failed refresh gracefully.
    setInterval(load, REFRESH_MS);

    // Keep the screen awake, and take the lock again after the tablet is woken
    // or the app is brought back to the front.
    let lock = null;
    const hold = async () => {
      try { if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen"); }
      catch {}
    };
    if ("wakeLock" in navigator) {
      hold();
      document.addEventListener("visibilitychange", hold);
    }
  }

  /* ---------- add to home screen ---------- */

  function installed(){
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function setupInstall(){
    if (TV || installed()) return;
    // Chrome offers to install on desktop too, but "put this on your phone" is
    // nonsense in front of somebody at a keyboard. A coarse pointer means a
    // finger, which covers phones and tablets and excludes a mouse.
    if (!matchMedia("(pointer: coarse)").matches) return;
    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch {}

    const box = $("install");
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    let prompt = null;

    const show = (html, canPrompt) => {
      $("installTxt").innerHTML = html;
      $("installGo").hidden = !canPrompt;
      box.hidden = false;
    };

    $("installNo").addEventListener("click", () => {
      box.hidden = true;
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    });

    $("installGo").addEventListener("click", async () => {
      box.hidden = true;
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice;
      prompt = null;
    });

    addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      prompt = e;
      show("<b>Keep this on your phone</b>Add the calendar to your home screen. No app store, nothing to install.", true);
    });

    // That event is not dependable. Safari never fires it at all, and Chrome
    // only does so when it decides the page qualifies. Adding to the home
    // screen works by hand on both regardless, so after a moment with the page
    // anyone who has not been offered the button gets told how.
    setTimeout(() => {
      if (!box.hidden) return;
      show(isIos
        ? "<b>Keep this on your phone</b>Tap Share at the bottom of Safari, then <b style=\"display:inline\">Add to Home Screen</b>."
        : "<b>Keep this on your phone</b>Open your browser's menu, then <b style=\"display:inline\">Add to Home screen</b>.",
        false);
    }, 4000);
  }

  /* ---------- go ---------- */

  if (TV) startTv();
  // No optimistic paint with the sample data. A flash of invented events, even
  // for a moment, is exactly what the labelling above exists to prevent.
  load();
  setupInstall();

})();
