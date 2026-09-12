import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The RSVP form on the public calendar page.
 *
 * The bug these exist for: what somebody had already said was read once, when
 * the card was drawn, and the click handler closed over that value. So the
 * first answer of a visit left the handler still holding "nothing said yet",
 * and pressing "change it" a moment later opened an empty form. Retyping a
 * name even slightly differently then landed the same family in the sheet
 * twice, which a leader reads as two families.
 */
const SITE = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

const SCRIPT = [...SITE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

test('the form is filled from what was said, read at the moment it opens', () => {
  assert.ok(SCRIPT.includes('const saved = () => myRsvps()[rsvpKey(e)];'),
    'the answer is no longer read through a function');

  // The form-filling block must use a fresh read, not the value captured when
  // the card was drawn.
  const at = SCRIPT.indexOf('const last = saved();');
  assert.notEqual(at, -1, 'the form no longer re-reads the answer when it opens');
  const block = SCRIPT.slice(at, at + 420);
  for (const field of ['r-name', 'r-count', 'r-phone', 'r-note']) {
    assert.ok(block.includes(field),
      field + ' is not filled back in, so it has to be retyped');
  }
});

test('everything given is remembered, not just the name and the number', () => {
  // "Change it" is for changing one thing. Remembering half of it means
  // retyping the other half, and a phone number retyped wrongly is worse
  // than no phone number.
  assert.ok(SCRIPT.includes('rememberRsvp(e, { name, count, phone, note });'),
    'the phone and note are not remembered');
});

test('the answer sent and the answer remembered are the same values', () => {
  // They used to be read from the form twice, separately. Two reads of the
  // same box is how the sheet and the browser end up disagreeing.
  const at = SCRIPT.indexOf('const phone = form.querySelector(".r-phone").value.trim();');
  assert.notEqual(at, -1, 'the phone is not read once into a value');
  // Counting reads, not the prefill, which writes to the same boxes.
  assert.equal(SCRIPT.split(String.raw`form.querySelector(".r-phone").value.trim()`).length - 1, 1,
    "the phone box is read more than once");
  assert.equal(SCRIPT.split(String.raw`form.querySelector(".r-note").value.trim()`).length - 1, 1,
    "the note box is read more than once");
});
