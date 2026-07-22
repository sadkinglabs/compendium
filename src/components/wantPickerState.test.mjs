// Picker state across cancellation - the interaction coverage the component lacked.
// Run: npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantPickerReducer as r, initialWantPicker as init } from './wantPickerState.js';
import { DEFAULT_WANT_FOIL } from '../store/wantIntent.js';

const run = (state, ...actions) => actions.reduce(r, state);

test('it starts from the product default', () => {
  assert.equal(init.foil, DEFAULT_WANT_FOIL);
  assert.equal(init.foil, false);
});

test('CANCEL resets the finish - the leak that prompted this module', () => {
  // Select Foil, cancel, open another card, and the next want must not be foil.
  const after = run(init,
    { type: 'open', cardId: 'c1' },
    { type: 'setFoil', foil: true },
    { type: 'close' },
    { type: 'open', cardId: 'c2' });
  assert.equal(after.foil, false, 'the foil choice did not survive the cancel');
});

test('backdrop and hardware back are the SAME action, so neither can forget', () => {
  const viaBackdrop = run(init, { type: 'setFoil', foil: true }, { type: 'close' });
  const viaBack = run(init, { type: 'setFoil', foil: true }, { type: 'close' });
  assert.deepEqual(viaBackdrop, viaBack);
  assert.equal(viaBackdrop.foil, false);
});

test('opening a DIFFERENT card resets even without an intervening close', () => {
  // A sheet re-pointed at another card is a new question; the previous card's finish is not an
  // answer to it.
  const after = run(init,
    { type: 'open', cardId: 'c1' },
    { type: 'setFoil', foil: true },
    { type: 'open', cardId: 'c2' });
  assert.equal(after.foil, false);
  assert.equal(after.cardId, 'c2');
});

test('re-opening the SAME card keeps the choice, so a re-render does not undo a tap', () => {
  const after = run(init,
    { type: 'open', cardId: 'c1' },
    { type: 'setFoil', foil: true },
    { type: 'open', cardId: 'c1' });
  assert.equal(after.foil, true, 'an idempotent open must not clobber user input');
});

test('open SEEDS the finish from the sheets active toggle - active Foil survives entry', () => {
  const after = run(init, { type: 'open', cardId: 'c1', foil: true });
  assert.equal(after.foil, true, 'a user on Foil reaches the picker already on Foil');
});

test('the seed is coerced and defaults when absent (null seed -> product default)', () => {
  assert.equal(run(init, { type: 'open', cardId: 'c1', foil: undefined }).foil, DEFAULT_WANT_FOIL);
  assert.equal(run(init, { type: 'open', cardId: 'c1', foil: 1 }).foil, true);   // real boolean, not 1
});

test('the seed applies only on the card TRANSITION, not on a same-card re-open', () => {
  // Seeded Foil, then the user picks Non-foil; a re-open (same card) with a stale Foil seed must
  // not clobber that deliberate choice.
  const after = run(init,
    { type: 'open', cardId: 'c1', foil: true },
    { type: 'setFoil', foil: false },
    { type: 'open', cardId: 'c1', foil: true });
  assert.equal(after.foil, false, 'a same-card re-open never re-seeds over user input');
});

test('the finish toggles both ways', () => {
  const on = run(init, { type: 'setFoil', foil: true });
  assert.equal(on.foil, true);
  assert.equal(r(on, { type: 'setFoil', foil: false }).foil, false);
});

test('an unknown action changes nothing', () => {
  const s = run(init, { type: 'open', cardId: 'c1' });
  assert.equal(r(s, { type: 'nonsense' }), s);
});
