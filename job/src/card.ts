/**
 * The printed calendar card.
 *
 * A half sheet, both sides, handed out at church and stuck on a fridge. It is
 * the one part of this system that reaches people who will never open the
 * website, and the only part that cannot be corrected after it ships.
 *
 * Historically the church sent a list to a print company who pasted it into
 * their own template. This produces the finished PDF instead, which means the
 * design is ours and any printer that accepts a PDF can print it.
 *
 * What goes on it:
 *
 *   - Two months, the two AFTER the month it is generated in. Cards are
 *     printed mid-month for the months ahead, so "current month" would be half
 *     spent before anybody held one.
 *   - Every public ministry, merged into one date order. A reader wants to
 *     know what is on the 14th, not which ministry owns it.
 *   - Every occurrence of a recurring event on its own line, because that is
 *     what a printed card is for: the dates, written down.
 *   - Deadlines marked in place, and recapped at the end so they read as a
 *     checklist.
 *
 * What does not:
 *
 *   - Routine events. The regular services and the 1st and 3rd Thursday supper
 *     would be forty identical lines across two months, crowding out the
 *     things people actually need to be told. They stay on the website and the
 *     wall display, where space is not scarce, and the card carries a standing
 *     note instead.
 *   - Private ministries, ever.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CalEvent, Config, Ministry } from './types.ts';
import { addMonths, startOfMonth } from './time.ts';

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------
//
// Half of US Letter, portrait. Bleed and safe margin are the values essentially
// every printer accepts; a printer wanting different ones is a number change
// here, not a redesign.

const PT = 72;                       // points per inch
const TRIM_W = 5.5 * PT;
const TRIM_H = 8.5 * PT;
const BLEED = 0.125 * PT;
const SAFE = 0.25 * PT;

const PAGE_W = TRIM_W + BLEED * 2;
const PAGE_H = TRIM_H + BLEED * 2;

/** Left edge of text, in page coordinates including the bleed. */
const L = BLEED + SAFE + 0.12 * PT;
const R = PAGE_W - BLEED - SAFE - 0.12 * PT;
const CONTENT_W = R - L;

const INK = rgb(0.141, 0.122, 0.106);      // #241F1B
const SOFT = rgb(0.42, 0.384, 0.353);      // #6B625A
const RULE = rgb(0.855, 0.827, 0.784);
const PINE = rgb(0.106, 0.369, 0.271);     // #1B5E45

/*
 * Nothing here depends on colour, so there is no separate black-and-white
 * file: a printer converts the PDF and it still reads correctly.
 *
 * That took a change. Deadlines were orange, and orange goes LIGHTER than
 * black in greyscale — so on a mono print the urgent lines would have come out
 * fainter than everything else, which is the exact opposite of the point. They
 * are bold black now, with a DUE marker, and the colour is decoration on top
 * of a distinction that already works without it.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type CardFonts = {
  display: PDFFont;
  displayBold: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
};

export type CardResult = { path: string; months: string[]; events: number; pages: number };

/** A line as it will be printed: one date, one thing happening. */
type Line = {
  day: number;
  dow: string;
  title: string;
  deadline: boolean;
  ministry: string;
};

// ---------------------------------------------------------------------------
// Choosing what goes on it
// ---------------------------------------------------------------------------

/**
 * The two months a card printed now should cover.
 *
 * Generated mid-month for the months ahead, so October's run produces November
 * and December. Never the current month: by the time a card is printed, folded
 * and handed out, half of it has already happened.
 */
export function cardMonths(now: Date, tz: string): Date[] {
  const first = startOfMonth(addMonths(now, 1, tz), tz);
  return [first, startOfMonth(addMonths(first, 1, tz), tz)];
}

function inMonth(iso: string, month: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
}

/**
 * One line per occurrence, in date order, for one month.
 *
 * `cardTitle` wins over the real title when a leader set one, which is the
 * only place that field is used.
 */
export function linesFor(
  events: CalEvent[],
  month: Date,
  publicIds: Set<string>,
): Line[] {
  return events
    .filter((e) => publicIds.has(e.ministry))
    // Routine is the standing rhythm — services, the fortnightly supper. It is
    // on the website and the wall; on a card it would be all there was room for.
    .filter((e) => e.type !== 'routine')
    .filter((e) => inMonth(e.start.dateTime ?? e.start.date ?? '', month))
    .map((e) => {
      const d = new Date(e.start.dateTime ?? (e.start.date ?? '') + 'T00:00:00');
      return {
        day: d.getDate(),
        dow: DOW[d.getDay()]!,
        title: (e.cardTitle || e.title || '').trim(),
        deadline: e.type === 'deadline',
        ministry: e.ministry,
      };
    })
    .filter((l) => l.title)
    .sort((a, b) => a.day - b.day);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/*
 * The date is two columns, not one string.
 *
 * "Sun 4" and "Sat 31" as single strings put their numbers at different
 * places, so the column of days came out ragged. The weekday sits left, the
 * number is right-aligned under itself, and the eye can run straight down.
 */
const DOW_COL = 0.34 * PT;    // "Sun", left-aligned
const NUM_COL = 0.19 * PT;    // the day number, right-aligned close after it
const DATE_COL = DOW_COL + NUM_COL;
/** The band between the numbers and the titles. DUE is centred in it. */
const DUE_COL = 0.42 * PT;
const LINE_SIZE = 10;
const LINE_GAP = 5;
const TITLE_W = () => CONTENT_W - DATE_COL - DUE_COL;

/** Height one entry will take once wrapped. */
function lineHeight(l: Line, f: CardFonts): number {
  const rows = wrap(l.title, l.deadline ? f.bodyBold : f.body, LINE_SIZE, TITLE_W());
  return rows.length * (LINE_SIZE + 2.4) + LINE_GAP;
}

function drawLine(page: PDFPage, l: Line, y: number, f: CardFonts): number {
  const dateSize = LINE_SIZE - 0.6;
  page.drawText(l.dow, {
    x: L, y: y - LINE_SIZE, size: dateSize, font: f.bodyBold, color: SOFT,
  });
  const num = String(l.day);
  page.drawText(num, {
    x: L + DATE_COL - f.bodyBold.widthOfTextAtSize(num, dateSize),
    y: y - LINE_SIZE, size: dateSize, font: f.bodyBold, color: SOFT,
  });

  // The marker, not the colour, is what says "deadline" — it survives a mono
  // print, a photocopy and a fridge in a dim kitchen.
  if (l.deadline) {
    // Centred in the gap rather than butted against the number, which read as
    // part of it: "15DUE".
    const size = LINE_SIZE - 3.2;
    const w = f.bodyBold.widthOfTextAtSize('DUE', size);
    page.drawText('DUE', {
      x: L + DATE_COL + (DUE_COL - w) / 2, y: y - LINE_SIZE + 0.4, size,
      font: f.bodyBold, color: rgb(0.82, 0.306, 0.169),
    });
  }

  const rows = wrap(l.title, l.deadline ? f.bodyBold : f.body, LINE_SIZE, TITLE_W());
  let ry = y;
  for (const row of rows) {
    page.drawText(row, {
      x: L + DATE_COL + DUE_COL, y: ry - LINE_SIZE, size: LINE_SIZE,
      font: l.deadline ? f.bodyBold : f.body, color: INK,
    });
    ry -= LINE_SIZE + 2.4;
  }
  return y - (rows.length * (LINE_SIZE + 2.4) + LINE_GAP);
}

function monthHeading(page: PDFPage, name: string, y: number, f: CardFonts): number {
  page.drawText(name.toUpperCase(), {
    x: L, y: y - 15, size: 15, font: f.displayBold, color: PINE,
  });
  page.drawLine({
    start: { x: L, y: y - 20 }, end: { x: R, y: y - 20 },
    thickness: 1.1, color: PINE,
  });
  return y - 32;
}

export type CardInput = {
  cfg: Config;
  ministries: Ministry[];
  events: CalEvent[];
  now: Date;
  outDir: string;
  /** The church logo, JPEG. Drawn at the top of the front. */
  logo?: Uint8Array;
  qrPdf?: Uint8Array;
  /**
   * Standing notes from the admin page, one per line, overriding the config
   * defaults. Blank or absent means fall back to config, so the card still
   * carries something sensible before anybody has touched the page.
   */
  standingNotes?: string;
};

export async function buildCard(input: CardInput): Promise<CardResult> {
  const { cfg, ministries, events, now, outDir } = input;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fontDir = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'assets', 'fonts');
  const load = (name: string) => doc.embedFont(readFileSync(join(fontDir, name)), { subset: true });
  const f: CardFonts = {
    display: await load('ZillaSlab-Regular.ttf'),
    displayBold: await load('ZillaSlab-Bold.ttf'),
    body: await load('PublicSans-Regular.ttf'),
    bodyBold: await load('PublicSans-SemiBold.ttf'),
  };

  const publicIds = new Set(
    ministries.filter((m) => m.visibility === 'public' && m.calendarId).map((m) => m.id),
  );
  const months = cardMonths(now, cfg.timezone);
  const byMonth = months.map((m) => ({ month: m, lines: linesFor(events, m, publicIds) }));

  const front = doc.addPage([PAGE_W, PAGE_H]);
  const back = doc.addPage([PAGE_W, PAGE_H]);
  for (const p of [front, back]) {
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: rgb(1, 1, 1) });
  }

  const TOP = PAGE_H - BLEED - SAFE - 6;

  // The QR sits in the same place on both sides, so both sides stop short of
  // the same line. On the front the standing notes share that band.
  const QR_SIZE = 62;
  const QR_X = R - QR_SIZE;
  const QR_Y = BLEED + SAFE + 2;
  // The label sits ABOVE the code rather than beside it. Beside, it shared a
  // band with the ruled notes lines and printed straight over them; above, the
  // code and its label are one block that everything else can avoid.
  const QR_LABEL_H = 22;
  const QR_TOP = QR_Y + QR_SIZE + QR_LABEL_H;
  const FOOT = QR_TOP + 10;

  // ---- masthead ----
  let y = TOP;
  if (input.logo) {
    const jpg = await doc.embedJpg(input.logo);
    const w = 2.5 * PT;
    const h = (jpg.height / jpg.width) * w;
    front.drawImage(jpg, { x: (PAGE_W - w) / 2, y: y - h, width: w, height: h });
    y -= h + 14;
  } else {
    front.drawText('GREATER LIFE BAPTIST CHURCH', {
      x: L, y: y - 13, size: 13, font: f.displayBold, color: PINE,
    });
    y -= 26;
  }

  /*
   * Fill the front, then spill onto the back.
   *
   * Not a month a side: a quiet month would leave a third of the front empty
   * while the back carried ten lines. Packing the front means the card is as
   * short as the events allow, and the back picks up whatever did not fit —
   * repeating the month's heading so a reader landing there is not looking at
   * a list of dates with no month attached.
   */
  let page = front;
  let onBack = false;
  const toBack = () => { page = back; onBack = true; y = TOP; };

  for (const { month, lines } of byMonth) {
    const name = MONTHS[month.getMonth()] + ' ' + month.getFullYear();

    // A heading with no room for even one line under it belongs on the next
    // page, not stranded at the foot of this one.
    const firstHeight = lines.length ? lineHeight(lines[0]!, f) : LINE_SIZE + 10;
    if (y - 32 - firstHeight < FOOT && !onBack) toBack();
    y = monthHeading(page, name, y, f);

    if (!lines.length) {
      page.drawText('Nothing scheduled yet.', {
        x: L, y: y - LINE_SIZE, size: LINE_SIZE, font: f.body, color: SOFT,
      });
      y -= LINE_SIZE + 10;
      continue;
    }

    for (const l of lines) {
      if (y - lineHeight(l, f) < FOOT) {
        if (onBack) break;                   // there is no third side
        toBack();
        y = monthHeading(page, name + ' (continued)', y, f);
      }
      y = drawLine(page, l, y, f);
    }
    y -= 10;
  }

  /*
   * Notes never begin on the front.
   *
   * Somebody looking at the card should see dates there, not ruled lines. If
   * everything fitted on the front then the whole back is notes, which is the
   * right answer for a quiet month: a card people can write on.
   */
  if (!onBack) toBack();
  else y -= 6;

  const deadlines = byMonth.flatMap(({ month, lines }) =>
    lines.filter((l) => l.deadline).map((l) => ({ ...l, month: month.getMonth() })));

  if (deadlines.length && y - 26 - deadlines.length * (LINE_SIZE + 6) > FOOT) {
    back.drawText("DON'T FORGET", {
      x: L, y: y - 11, size: 11, font: f.displayBold, color: rgb(0.82, 0.306, 0.169),
    });
    back.drawLine({
      start: { x: L, y: y - 15 }, end: { x: R, y: y - 15 },
      thickness: 0.9, color: rgb(0.82, 0.306, 0.169),
    });
    y -= 26;
    // Exactly the columns and sizes the dated list uses. It sat on its own
    // geometry and its titles started short of the ones above it, which on a
    // card this size reads immediately as two things that do not line up.
    const dateSize = LINE_SIZE - 0.6;
    for (const d of deadlines) {
      back.drawText(MONTHS[d.month]!.slice(0, 3), {
        x: L, y: y - LINE_SIZE, size: dateSize, font: f.bodyBold, color: SOFT,
      });
      const dnum = String(d.day);
      back.drawText(dnum, {
        x: L + DATE_COL - f.bodyBold.widthOfTextAtSize(dnum, dateSize),
        y: y - LINE_SIZE, size: dateSize, font: f.bodyBold, color: SOFT,
      });
      back.drawText(wrap(d.title, f.body, LINE_SIZE, TITLE_W())[0]!, {
        x: L + DATE_COL + DUE_COL, y: y - LINE_SIZE, size: LINE_SIZE,
        font: f.body, color: INK,
      });
      y -= LINE_SIZE + 6;
    }
    y -= 10;
  }

  // Ruled lines down the rest of the back. The ones that reach the QR's band
  // stop short of it rather than the whole block stopping early, which would
  // waste the width of the page for the sake of one corner.
  if (y - 30 > QR_Y) {
    back.drawText('NOTES', { x: L, y: y - 10, size: 10, font: f.displayBold, color: SOFT });
    y -= 22;
    while (y > QR_Y + 4) {
      // Lines that reach the code's block stop short of it. The whole block,
      // label included, so nothing is ever printed over.
      const beside = y < QR_TOP + 4;
      back.drawLine({
        start: { x: L, y }, end: { x: beside ? QR_X - 12 : R, y },
        thickness: 0.5, color: RULE,
      });
      y -= 19;
    }
  }

  // ---- the standing notes, front only, and the QR on both ----
  const notes = (input.standingNotes ?? '').trim()
    ? input.standingNotes!.split(/\r?\n/).map((n) => n.trim()).filter(Boolean)
    : (cfg.card?.standingNotes ?? []);
  /*
   * The notes run to just short of the code, the way the ruled lines do.
   *
   * They used to stop far earlier, because the width was reserving room for
   * the "scan for the live calendar" label back when that sat beside the code.
   * The label is above it now, so the only thing to avoid is the square.
   *
   * Anchored at the bottom and grown upward, so adding a second or third note —
   * service times, say — pushes the block up into the space already reserved
   * for it rather than off the foot of the card.
   */
  const noteRows = notes.flatMap((n) => wrap(n, f.body, 8.4, QR_X - 12 - L));
  let fy = BLEED + SAFE + 6 + (noteRows.length - 1) * 11;
  for (const row of noteRows) {
    front.drawText(row, { x: L, y: fy, size: 8.4, font: f.body, color: SOFT });
    fy -= 11;
  }

  if (input.qrPdf) {
    const [qrFront, qrBack] = await doc.embedPdf(input.qrPdf, [0, 0]);
    // Right-aligned to the code's own right edge, so the block reads as one
    // thing rather than a caption that drifted.
    const right = (pg: PDFPage, text: string, yy: number, size: number, font: PDFFont, color: typeof INK) => {
      pg.drawText(text, { x: R - font.widthOfTextAtSize(text, size), y: yy, size, font, color });
    };
    for (const [pg, qr] of [[front, qrFront], [back, qrBack]] as const) {
      pg.drawPage(qr!, { x: QR_X, y: QR_Y, width: QR_SIZE, height: QR_SIZE });
      right(pg, 'Scan for the', QR_Y + QR_SIZE + 12, 8.4, f.body, SOFT);
      right(pg, 'live calendar', QR_Y + QR_SIZE + 1, 9.6, f.bodyBold, INK);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const name = months[0]!.getFullYear() + '-' +
    String(months[0]!.getMonth() + 1).padStart(2, '0') + '-card.pdf';
  const path = join(outDir, name);
  writeFileSync(path, await doc.save());

  return {
    path,
    months: months.map((m) => MONTHS[m.getMonth()] + ' ' + m.getFullYear()),
    events: byMonth.reduce((n, m) => n + m.lines.length, 0),
    pages: 2,
  };
}

export { existsSync };
