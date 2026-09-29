import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Standing slides on the wall display.
 *
 * Things worth saying that are not events — who to see about serving, how to
 * give — taking their turn in the same rotation the calendar days go through.
 *
 * The order is the whole design and it cannot be checked by looking: the
 * screen changes every fourteen seconds, and a mistake here shows up as "that
 * one never seems to come up", weeks later. So the decision is a pure function
 * with no timers or DOM in it, lifted out of the page and run.
 */
const TV = readFileSync(new URL('../../site/tv.html', import.meta.url), 'utf8');
const SCRIPT = [...TV.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

function lift<T>(name: string): T {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is no longer in tv.html');
  const open = SCRIPT.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === '{') depth++;
    else if (SCRIPT[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, 'could not find the end of ' + name);
  return new Function(SCRIPT.slice(at, end) + '; return ' + name + ';')() as T;
}

type Turn = { kind: 'day' | 'slide'; index: number; next: State } | null;
type State = { day: number; slide: number; since: number };

const pickTurn = lift<(s: State, d: number, sl: number, e: number) => Turn>('pickTurn');

/** The first `turns` of the rotation, as "d0 d1 d2 s0 ..." for reading. */
function run(dayCount: number, slideCount: number, every: number, turns: number): string {
  let state: State = { day: 0, slide: 0, since: 0 };
  const out: string[] = [];
  for (let i = 0; i < turns; i++) {
    const turn = pickTurn(state, dayCount, slideCount, every);
    if (!turn) break;
    out.push((turn.kind === 'day' ? 'd' : 's') + turn.index);
    state = turn.next;
  }
  return out.join(' ');
}

test('three calendar days, then a slide, then three more, then the next slide', () => {
  // The plan, exactly as agreed. Note s0 then s1: the slides take turns, so a
  // second one is not something nobody ever sees.
  assert.equal(
    run(5, 2, 3, 12),
    'd0 d1 d2 s0 d3 d4 d0 s1 d1 d2 d3 s0',
  );
});

test('the interval is how many days go by, whatever it is set to', () => {
  assert.equal(run(4, 1, 1, 6), 'd0 s0 d1 s0 d2 s0');
  assert.equal(run(9, 1, 5, 7), 'd0 d1 d2 d3 d4 s0 d5');
});

test('every slide gets its turn before the first comes round again', () => {
  // Six slides was the number Spencer expected to end up with. The sixth has
  // to appear as reliably as the first.
  const seq = run(3, 6, 3, 24).split(' ').filter((t) => t.startsWith('s'));
  assert.deepEqual(seq, ['s0', 's1', 's2', 's3', 's4', 's5']);
});

test('with nothing on the calendar the slides carry the screen alone', () => {
  // Otherwise a quiet January sits on a frozen grid, which reads as broken.
  assert.equal(run(0, 3, 3, 7), 's0 s1 s2 s0 s1 s2 s0');
});

test('with no slides it behaves exactly as it did before they existed', () => {
  assert.equal(run(3, 0, 3, 7), 'd0 d1 d2 d0 d1 d2 d0');
});

test('with neither, nothing is shown rather than something empty', () => {
  assert.equal(pickTurn({ day: 0, slide: 0, since: 0 }, 0, 0, 3), null);
});

test('fewer days than the interval still reaches the slides', () => {
  // Two upcoming days and "every third" means days repeat first. The thing
  // that must not happen is the slide never arriving.
  assert.equal(run(2, 1, 3, 8), 'd0 d1 d0 s0 d1 d0 d1 s0');
});

// ---------------------------------------------------------------------------
// what the page does with them
// ---------------------------------------------------------------------------

test('a slide is drawn without borrowing the last day it showed', () => {
  // showSpot anchors itself to a day cell and leaves its own classes behind.
  // A slide has no day to grow out of, so both have to state their class.
  assert.ok(SCRIPT.includes('spot.className = "spot slide";'),
    'a slide does not set its own class');
  assert.ok(SCRIPT.includes('spot.className = "spot";'),
    'a day after a slide would keep the slide styling');
});

test('the rotation is only restarted when the slides actually change', () => {
  // The poll runs every two minutes. Restarting on each one would mean the
  // later slides never came round at all.
  assert.ok(SCRIPT.includes('if (deck !== JSON.stringify(SLIDES) || every !== SLIDE_EVERY)'),
    'the poll restarts the rotation unconditionally');
});

test('the admin page saves the list and the rhythm together', () => {
  const ADMIN = readFileSync(new URL('../../site/admin.html', import.meta.url), 'utf8');
  assert.ok(ADMIN.includes('action:"admin.slides", ...auth(), slides,'),
    'the slides are not sent with a credential');
  assert.ok(ADMIN.includes('slideEvery: Number($("slideEvery").value) || 3'),
    'the interval is not saved with the slides');
});
