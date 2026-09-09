import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonth } from '../src/month.ts';

test('every way somebody might write January 2027', () => {
  for (const raw of [
    '2027-01', '2027-1', '2027/01', '2027/1',
    '01/2027', '1/2027', '01-2027', '1-2027',
    '01/27', '1/27', '01-27', '1-27',
    '27-01', '27/1',
    'Jan 2027', 'jan 2027', 'January 2027', 'JANUARY 2027',
    '2027 Jan', 'Jan/2027', 'Jan-27',
    '  1 / 2027  ',
  ]) {
    assert.equal(parseMonth(raw), '2027-01', 'could not read ' + JSON.stringify(raw));
  }
});

test('December, where a leading zero cannot help', () => {
  for (const raw of ['2026-12', '12/2026', '12/26', '26-12', 'Dec 2026', 'December 2026']) {
    assert.equal(parseMonth(raw), '2026-12', 'could not read ' + JSON.stringify(raw));
  }
});

test('a first number above twelve can only be the year', () => {
  // 27-01 is 2027 January. 01-27 is January 2027. Both land in the same place,
  // which is the point: neither reading is silently wrong.
  assert.equal(parseMonth('27-01'), '2027-01');
  assert.equal(parseMonth('01-27'), '2027-01');
  assert.equal(parseMonth('30-06'), '2030-06');
});

test('nonsense is refused rather than guessed at', () => {
  for (const raw of [
    '', '   ', 'january', '2027', '13/2027', '00/2027', '2027-13', '2027-00',
    '1/2/2027', 'next month', 'Jan', '2019-01', '2101-01', 'Smarch 2027',
  ]) {
    assert.equal(parseMonth(raw), null, JSON.stringify(raw) + ' should not parse');
  }
});

test('a card is never made for the wrong century by a typo', () => {
  assert.equal(parseMonth('0227-01'), null);
  assert.equal(parseMonth('227-01'), null);
});
