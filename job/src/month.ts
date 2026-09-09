/**
 * Reading a month the way somebody actually types one.
 *
 * The card's "first month" box is filled in once a month by whoever runs the
 * church calendar, on a phone. Insisting on `2027-01` means the one person who
 * types `1/27` gets an error for no reason a human would accept, so this takes
 * whatever is offered:
 *
 *   2027-01   2027/1   01/2027   1/2027   01-27   1-27   27-01
 *   Jan 2027  January 2027  2027 Jan
 *
 * The same rule is implemented in `parseMonth_` in site/apps-script/Code.gs, so
 * the admin page can reject a typo immediately rather than sending somebody a
 * failure email a minute later. Two implementations of fifteen lines is the
 * cheaper mistake here; the alternative is a round trip to find out you missed
 * a digit.
 */

const NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** 1-12 for a name or abbreviation, or null. */
function monthFromName(word: string): number | null {
  const w = word.toLowerCase();
  const i = NAMES.findIndex((n) => n === w || (w.length >= 3 && n.startsWith(w)));
  return i === -1 ? null : i + 1;
}

/**
 * Normalise to `YYYY-MM`, or null when it cannot be read as a month.
 *
 * Ambiguity is resolved the way the numbers allow. Two short numbers are
 * month-then-year, because that is how the box is labelled and how people
 * write dates — unless the first is above twelve, in which case it cannot be a
 * month and must be the year.
 */
export function parseMonth(raw: string): string | null {
  const parts = String(raw ?? '').trim().split(/[^0-9A-Za-z]+/).filter(Boolean);
  if (parts.length !== 2) return null;

  let year: number | null = null;
  let month: number | null = null;
  const short: number[] = [];

  for (const part of parts) {
    if (/^\d{4}$/.test(part)) year = Number(part);
    else if (/^\d{1,2}$/.test(part)) short.push(Number(part));
    else {
      const named = monthFromName(part);
      if (named === null) return null;
      month = named;
    }
  }

  if (month === null && short.length === 2) {
    const [first, second] = short as [number, number];
    // 27-01 can only be a year and a month; 01-27 reads as month and year.
    if (first > 12) { year = 2000 + first; month = second; }
    else { month = first; year = 2000 + second; }
  } else if (short.length === 1) {
    const only = short[0]!;
    if (year === null) year = 2000 + only;
    else if (month === null) month = only;
    else return null;
  } else if (short.length > 2) {
    return null;
  }

  if (year === null || month === null) return null;
  if (month < 1 || month > 12) return null;
  // Wide enough for anything anybody would print, narrow enough that a typo
  // like 0227 is refused rather than quietly producing a card for 227 AD.
  if (year < 2020 || year > 2099) return null;

  return year + '-' + String(month).padStart(2, '0');
}
