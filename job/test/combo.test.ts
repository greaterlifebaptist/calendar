import test from 'node:test';
import assert from 'node:assert/strict';
import { comboSlug, comboMinistries } from '../src/combo.ts';
import { loadConfig } from '../src/config.ts';

const cfg = loadConfig();

test('the slug does not depend on the order boxes were ticked', () => {
  assert.equal(comboSlug(['youth', 'church']), comboSlug(['church', 'youth']));
  assert.equal(comboSlug(['church', 'youth']), 'church~youth');
  assert.equal(comboSlug(['youth', 'youth']), 'youth');
});

test('no ministry id contains the separator, or the slug becomes ambiguous', () => {
  // Three places build this string independently: here, comboSlug_ in
  // Code.gs, and the subscribe buttons on the calendar page. A separator that
  // could appear inside an id would make one slug mean two selections
  // depending on who split it.
  //
  // Checked against EVERY ministry, not only the public ones, because a
  // private ministry can be made public later and that must not be the moment
  // every saved URL turns ambiguous.
  for (const m of cfg.ministries) {
    assert.ok(!m.id.includes('~'), m.id + ' contains the separator and would break the slug');
  }
});

test('private ministries are never selectable', () => {
  const ids = comboMinistries(cfg).map((m) => m.id);
  for (const m of cfg.ministries) {
    if (m.visibility !== 'public') {
      assert.ok(!ids.includes(m.id), m.id + ' is private but offered as a choice');
    }
  }
});
