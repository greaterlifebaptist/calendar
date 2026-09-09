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

const DATE_COL = 0.62 * PT;   // width reserved for "Thu 14"
const LINE_SIZE = 8.6;
const LINE_GAP = 3.2;

/** Height one entry will take once wrapped. */
function lineHeight(l: Line, f: CardFonts): number {
  const rows = wrap(l.title, f.body, LINE_SIZE, CONTENT_W - DATE_COL - 6);
  return rows.length * (LINE_SIZE + 1.6) + LINE_GAP;
}

function drawLine(page: PDFPage, l: Line, y: number, f: CardFonts): number {
  const label = l.dow + ' ' + l.day;
  page.drawText(label, {
    x: L, y: y - LINE_SIZE, size: LINE_SIZE - 0.4,
    font: f.bodyBold, color: l.deadline ? rgb(0.82, 0.306, 0.169) : SOFT,
  });

  const rows = wrap(l.title, l.deadline ? f.bodyBold : f.body, LINE_SIZE, CONTENT_W - DATE_COL - 6);
  let ry = y;
  for (const row of rows) {
    page.drawText(row, {
      x: L + DATE_COL + 6, y: ry - LINE_SIZE, size: LINE_SIZE,
      font: l.deadline ? f.bodyBold : f.body, color: INK,
    });
    ry -= LINE_SIZE + 1.6;
  }
  return y - (rows.length * (LINE_SIZE + 1.6) + LINE_GAP);
}

function monthHeading(page: PDFPage, name: string, y: number, f: CardFonts): number {
  page.drawText(name.toUpperCase(), {
    x: L, y: y - 11, size: 11, font: f.displayBold, color: PINE,
  });
  page.drawLine({
    start: { x: L, y: y - 15 }, end: { x: R, y: y - 15 },
    thickness: 0.9, color: PINE,
  });
  return y - 24;
}

export type CardInput = {
  cfg: Config;
  ministries: Ministry[];
  events: CalEvent[];
  now: Date;
  outDir: string;
  logo?: Uint8Array;
  qrPdf?: Uint8Array;
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

  // ---- masthead ----
  let y = PAGE_H - BLEED - SAFE - 6;
  if (input.logo) {
    const png = await doc.embedPng(input.logo);
    const w = 2.1 * PT;
    const h = (png.height / png.width) * w;
    front.drawImage(png, { x: L, y: y - h, width: w, height: h });
    y -= h + 8;
  } else {
    front.drawText('GREATER LIFE BAPTIST CHURCH', {
      x: L, y: y - 12, size: 12, font: f.displayBold, color: PINE,
    });
    y -= 22;
  }

  const span = MONTHS[months[0]!.getMonth()] + ' & ' + MONTHS[months[1]!.getMonth()] +
    ' ' + months[1]!.getFullYear();
  front.drawText(span, { x: L, y: y - 13, size: 13, font: f.displayBold, color: INK });
  y -= 24;

  // ---- the months ----
  let page = front;
  let onBack = false;
  const bottomLimit = () => BLEED + SAFE + (onBack ? 150 : 74);

  for (const { month, lines } of byMonth) {
    if (y - 30 < bottomLimit() && !onBack) { page = back; onBack = true; y = PAGE_H - BLEED - SAFE - 6; }
    y = monthHeading(page, MONTHS[month.getMonth()] + ' ' + month.getFullYear(), y, f);

    if (!lines.length) {
      page.drawText('Nothing scheduled yet.', {
        x: L, y: y - LINE_SIZE, size: LINE_SIZE, font: f.body, color: SOFT,
      });
      y -= LINE_SIZE + 8;
      continue;
    }

    for (const l of lines) {
      if (y - lineHeight(l, f) < bottomLimit()) {
        if (onBack) break;                    // no third side to spill onto
        page = back; onBack = true; y = PAGE_H - BLEED - SAFE - 6;
        y = monthHeading(page, MONTHS[month.getMonth()] + ' ' + month.getFullYear() + ' (continued)', y, f);
      }
      y = drawLine(page, l, y, f);
    }
    y -= 6;
  }

  // ---- don't forget, above the notes ----
  const deadlines = byMonth.flatMap(({ month, lines }) =>
    lines.filter((l) => l.deadline).map((l) => ({ ...l, month: month.getMonth() })));

  let ny = onBack ? Math.min(y - 10, BLEED + SAFE + 150) : BLEED + SAFE + 150;
  if (deadlines.length) {
    back.drawText("DON'T FORGET", { x: L, y: ny - 9, size: 9, font: f.displayBold, color: rgb(0.82, 0.306, 0.169) });
    ny -= 15;
    for (const d of deadlines.slice(0, 6)) {
      const label = MONTHS[d.month]!.slice(0, 3) + ' ' + d.day + '  ' + d.title;
      back.drawText(wrap(label, f.body, 8, CONTENT_W)[0]!, {
        x: L, y: ny - 8, size: 8, font: f.body, color: INK,
      });
      ny -= 11;
    }
    ny -= 4;
  }

  // ---- notes ----
  back.drawText('NOTES', { x: L, y: ny - 9, size: 9, font: f.displayBold, color: SOFT });
  ny -= 16;
  while (ny > BLEED + SAFE + 12) {
    back.drawLine({ start: { x: L, y: ny }, end: { x: R, y: ny }, thickness: 0.5, color: RULE });
    ny -= 15;
  }

  // ---- footer: standing notes and the QR ----
  const notes = cfg.card?.standingNotes ?? [];
  let fy = BLEED + SAFE + 62;
  for (const n of notes) {
    for (const row of wrap(n, f.body, 7.6, CONTENT_W - 70)) {
      front.drawText(row, { x: L, y: fy, size: 7.6, font: f.body, color: SOFT });
      fy -= 10;
    }
  }

  if (input.qrPdf) {
    const [qr] = await doc.embedPdf(input.qrPdf);
    const size = 58;
    front.drawPage(qr!, { x: R - size, y: BLEED + SAFE + 4, width: size, height: size });
    front.drawText('Scan for the', { x: R - size - 78, y: BLEED + SAFE + 34, size: 7.6, font: f.body, color: SOFT });
    front.drawText('live calendar', { x: R - size - 78, y: BLEED + SAFE + 24, size: 8.6, font: f.bodyBold, color: INK });
    front.drawText('greaterlifebaptistchurch.com/calendar', {
      x: L, y: BLEED + SAFE + 6, size: 6.4, font: f.body, color: SOFT,
    });
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
