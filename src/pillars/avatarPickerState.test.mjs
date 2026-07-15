// Transition fixtures for the avatar picker's selection state
// (src/pillars/avatarPickerState.js).
// Run: npm run test:ui   (node --test)
//
// Two jobs: (1) pin the tap semantics, because they ARE the mirror-match feature
// and none of them is checked by the type system; (2) lock the property the whole
// design rests on - the armed slot is where the next card tap lands, ALWAYS, so the
// glow can never promise something a tap does not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionReducer, initialSelection, isReady, isMirror, rolesOf, armedRole } from './avatarPickerState.js';

const avatar = (id) => ({ card_id: id, name: `Avatar ${id}`, image_slug: `${id}.png` });
const A = avatar('a'), B = avatar('b');
const deck = (id, av) => ({ id, name: `Deck ${id}`, avatar: av });

const run = (state, ...actions) => actions.reduce(selectionReducer, state);
const tap = (card) => ({ type: 'tapAvatar', card });
const slot = (role) => ({ type: 'tapSlot', role });
const pickDeck = (d) => ({ type: 'pickDeck', deck: d });

// --- the armed slot -----------------------------------------------------------

test('YOU is armed from the start - nothing to aim on open', () => {
  assert.equal(armedRole(initialSelection), 'you');
});

test('OPPONENT arms itself the moment YOU is filled', () => {
  const s = run(initialSelection, tap(A));
  assert.deepEqual(s.you, A);
  assert.equal(armedRole(s), 'opponent');
});

test('nothing is armed once both are full', () => {
  assert.equal(armedRole(run(initialSelection, tap(A), tap(B))), null);
});

test('clearing a slot re-arms it without an explicit target', () => {
  const s = run(initialSelection, tap(A), tap(B), slot('you'));
  assert.equal(s.targetedRole, null, 're-arming is derived, not stored');
  assert.equal(armedRole(s), 'you');
});

// --- ordinary selection -------------------------------------------------------

test('empty -> tapping an avatar assigns YOU', () => {
  const s = run(initialSelection, tap(A));
  assert.deepEqual(s.you, A);
  assert.equal(s.opponent, null);
});

test('YOU + a new avatar -> fills OPPONENT', () => {
  const s = run(initialSelection, tap(A), tap(B));
  assert.deepEqual(s.you, A);
  assert.deepEqual(s.opponent, B);
  assert.ok(isReady(s));
  assert.ok(!isMirror(s));
});

test('both slots full -> a card tap is inert, because nothing is armed', () => {
  const s = run(initialSelection, tap(A), tap(B));
  assert.equal(run(s, tap(avatar('c'))), s);
  assert.equal(run(s, tap(A)), s, 'even a card already in play does nothing');
});

// --- the load-bearing invariant ------------------------------------------------

test('a card tap ALWAYS lands in the armed slot, whatever the card', () => {
  // the glow promises a destination; every tap must honour it
  for (const card of [A, B, avatar('c')]) {
    const s = run(initialSelection, tap(A));      // YOU = A, OPPONENT armed
    assert.deepEqual(run(s, tap(card)).opponent, card);
    assert.deepEqual(run(s, tap(card)).you, A, 'the filled slot is never disturbed');
  }
});

test('tapping the avatar already in YOU mirrors it, since OPPONENT is armed', () => {
  const s = run(initialSelection, tap(A), tap(A));
  assert.deepEqual(s.you, A);
  assert.deepEqual(s.opponent, A);
  assert.ok(isMirror(s));
});

// --- deselection lives on the slots -------------------------------------------

test('a populated slot clears exactly its own role in one tap', () => {
  const s = run(initialSelection, tap(A), tap(B));
  assert.equal(run(s, slot('you')).you, null);
  assert.deepEqual(run(s, slot('you')).opponent, B);
  assert.equal(run(s, slot('opponent')).opponent, null);
  assert.deepEqual(run(s, slot('opponent')).you, A);
});

test('mirrored -> each slot clears only its own side', () => {
  const s = run(initialSelection, tap(A), tap(A));
  assert.equal(run(s, slot('you')).you, null);
  assert.deepEqual(run(s, slot('you')).opponent, A);
  assert.deepEqual(run(s, slot('opponent')).you, A);
  assert.equal(run(s, slot('opponent')).opponent, null);
});

// --- overriding the order -----------------------------------------------------

test('tapping the empty OPPONENT slot first aims there, beating the YOU-first order', () => {
  const s = run(initialSelection, slot('opponent'));
  assert.equal(armedRole(s), 'opponent');
  const t = run(s, tap(A));
  assert.equal(t.you, null, 'YOU is empty but OPPONENT was aimed at');
  assert.deepEqual(t.opponent, A);
});

test('aiming at a slot again releases the override, back to the derived order', () => {
  const s = run(initialSelection, slot('opponent'), slot('opponent'));
  assert.equal(s.targetedRole, null);
  assert.equal(armedRole(s), 'you');
});

test('an override is spent by the pick that uses it', () => {
  const s = run(initialSelection, slot('opponent'), tap(A));
  assert.equal(s.targetedRole, null);
  assert.equal(armedRole(s), 'you', 'YOU is still empty, so it arms next');
});

// --- decks --------------------------------------------------------------------

test('picking a deck links it and fills YOU from its avatar', () => {
  const s = run(initialSelection, pickDeck(deck('d1', A)));
  assert.deepEqual(s.you, A);
  assert.equal(s.deck.id, 'd1');
  assert.equal(armedRole(s), 'opponent', 'filling YOU arms the opponent, however it was filled');
});

test('picking the same deck again unlinks it and keeps the avatar', () => {
  const d = deck('d1', A);
  const s = run(initialSelection, pickDeck(d), pickDeck(d));
  assert.equal(s.deck, null);
  assert.deepEqual(s.you, A, 'unlinking the ledger must not undo the pick');
});

test('switching decks while OPPONENT is populated replaces YOU only', () => {
  const s = run(run(initialSelection, tap(A), tap(B)), pickDeck(deck('d2', avatar('c'))));
  assert.deepEqual(s.you, avatar('c'));
  assert.deepEqual(s.opponent, B, 'opponent is untouched by a deck switch');
});

test('a deck with no avatar links the ledger and leaves the pick alone', () => {
  const s = run(initialSelection, tap(A), pickDeck(deck('d1', null)));
  assert.deepEqual(s.you, A);
  assert.equal(s.deck.id, 'd1');
});

test('a deck pick spends a YOU override - the deck just filled that slot', () => {
  const s = run(initialSelection, slot('you'), pickDeck(deck('d1', A)));
  assert.equal(s.targetedRole, null);
  assert.equal(armedRole(s), 'opponent');
});

test('a deck pick does NOT spend an OPPONENT override - that slot is still owed', () => {
  const s = run(initialSelection, slot('opponent'), pickDeck(deck('d1', A)));
  assert.deepEqual(s.you, A, 'the deck fills YOU');
  assert.equal(armedRole(s), 'opponent', 'the opponent slot is still glowing, so it must still be live');
  assert.deepEqual(run(s, tap(A)).opponent, A, 'and it still receives the next tap');
});

// --- misc ---------------------------------------------------------------------

test('rolesOf reports both roles for a mirrored card', () => {
  const s = run(initialSelection, tap(A), tap(A));
  assert.deepEqual(rolesOf(s, A), { you: true, opponent: true });
  assert.deepEqual(rolesOf(s, B), { you: false, opponent: false });
});

test('an unknown action is inert', () => {
  const s = run(initialSelection, tap(A));
  assert.equal(selectionReducer(s, { type: 'nope' }), s);
});
