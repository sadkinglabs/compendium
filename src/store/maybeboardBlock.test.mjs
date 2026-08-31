// Managed Maybeboard notes block - Step 1 of the SorceryTCG migration.
// Run: npm run test:query
// Pure-function suite: render aggregation/ordering/emptiness, block location
// (including the missing-END self-heal), in-place replacement with byte-exact
// user text on both sides, append and removal seams, and double-apply
// idempotence across blocks at the start, middle, and end of the notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAYBEBOARD_BEGIN,
  MAYBEBOARD_END,
  renderMaybeboardBlock,
  applyMaybeboardBlock,
} from './maybeboardBlock.js';

const B = MAYBEBOARD_BEGIN;
const E = MAYBEBOARD_END;
const m = (name, qty) => ({ name, qty });

test('delimiters are the agreed literals', () => {
  assert.equal(B, '--- Maybeboard (synced from SorceryTCG) ---');
  assert.equal(E, '--- end Maybeboard ---');
});

test('render: empty, nullish, and all-unusable lists produce null', () => {
  assert.equal(renderMaybeboardBlock([]), null);
  assert.equal(renderMaybeboardBlock(null), null);
  assert.equal(renderMaybeboardBlock(undefined), null);
  assert.equal(renderMaybeboardBlock([m('', 2), null, m('Zero', 0)]), null);
});

test('render: aggregates by exact name and sorts by localeCompare', () => {
  const out = renderMaybeboardBlock([m('Pyromancer', 1), m('Avatar of Fire', 2), m('Pyromancer', 3)]);
  assert.equal(out, [B, '2x Avatar of Fire', '4x Pyromancer', E].join('\n'));
  assert.equal(out.endsWith(E), true);                 // no trailing newline
  // Input order must not matter: the same set renders the same block.
  assert.equal(renderMaybeboardBlock([m('Pyromancer', 4), m('Avatar of Fire', 2)]), out);
});

test('render: exact-name grain keeps case and spacing variants apart', () => {
  const out = renderMaybeboardBlock([m('Pond', 1), m('pond', 1)]);
  assert.equal(out.split('\n').length, 4);             // BEGIN + two lines + END
});

test('apply: appends to empty notes with no leading blank line', () => {
  const block = renderMaybeboardBlock([m('Pond', 1)]);
  assert.equal(applyMaybeboardBlock('', [m('Pond', 1)]), block);
  assert.equal(applyMaybeboardBlock(null, [m('Pond', 1)]), block);
  assert.equal(applyMaybeboardBlock('   \n\n ', [m('Pond', 1)]), block);
});

test('apply: appends to non-empty notes after exactly one blank line', () => {
  const out = applyMaybeboardBlock('My plan for this deck.', [m('Pond', 2)]);
  assert.equal(out, `My plan for this deck.\n\n${B}\n2x Pond\n${E}`);
  // Existing trailing whitespace does not stack up extra blank lines.
  assert.equal(applyMaybeboardBlock('My plan for this deck.\n\n\n  ', [m('Pond', 2)]), out);
});

test('apply: replaces in place, preserving user text before AND after byte-for-byte', () => {
  const notes = `Header line\n  indented note  \n\n${B}\n1x Stale\n${E}\n\nTrailing thoughts\n\tand a tab`;
  const out = applyMaybeboardBlock(notes, [m('Fresh', 3)]);
  assert.equal(out, `Header line\n  indented note  \n\n${B}\n3x Fresh\n${E}\n\nTrailing thoughts\n\tand a tab`);
  assert.equal(out.startsWith('Header line\n  indented note  \n\n'), true);
  assert.equal(out.endsWith('\n\nTrailing thoughts\n\tand a tab'), true);
});

test('apply: an indented delimiter still identifies the block (trimmed match)', () => {
  const notes = `Before\n   ${B}\n1x Old\n  ${E}   \nAfter`;
  assert.equal(applyMaybeboardBlock(notes, [m('New', 1)]), `Before\n${B}\n1x New\n${E}\nAfter`);
});

test('apply: BEGIN without END heals - the block runs to end of string', () => {
  const notes = `Keep me\n\n${B}\n1x Old\nstray text a user typed under it`;
  const out = applyMaybeboardBlock(notes, [m('New', 1)]);
  assert.equal(out, `Keep me\n\n${B}\n1x New\n${E}`);
  assert.equal(out.split(B).length - 1, 1);            // healed, not duplicated
});

test('apply: empty entries remove the block and collapse the seam to one blank line', () => {
  const notes = `Above\n\n${B}\n1x Old\n${E}\n\nBelow`;
  assert.equal(applyMaybeboardBlock(notes, []), 'Above\n\nBelow');
  // A single-newline seam is left as it was found, not widened.
  assert.equal(applyMaybeboardBlock(`Above\n${B}\n1x Old\n${E}\nBelow`, []), 'Above\nBelow');
});

test('apply: removal that leaves only whitespace yields the empty string', () => {
  assert.equal(applyMaybeboardBlock(`${B}\n1x Old\n${E}`, []), '');
  assert.equal(applyMaybeboardBlock(`\n\n  ${B}\n1x Old\n${E}\n\n  `, []), '');
  assert.equal(applyMaybeboardBlock(`Note\n\n${B}\n1x Old\n${E}\n\n`, []), 'Note');
});

test('apply: no block plus empty entries returns the input byte-identical', () => {
  const corpora = ['', '   ', 'Just my notes.\n\n\nWith gaps.  ', '\n\nleading and trailing\n\n'];
  for (const notes of corpora) assert.equal(applyMaybeboardBlock(notes, []), notes);
  assert.equal(applyMaybeboardBlock(null, []), '');
  assert.equal(applyMaybeboardBlock(undefined, null), '');
});

test('apply: double application is a no-op for every corpus', () => {
  const entrySets = [[], [m('Pond', 1)], [m('Pond', 1), m('Avatar of Fire', 2), m('Pond', 3)]];
  const corpora = [
    '',
    'Plain notes with no block.',
    `${B}\n1x Old\n${E}\n\nBlock at the start`,                       // start
    `Above\n\n${B}\n1x Old\n${E}\n\nBelow`,                           // middle
    `Above\n\n${B}\n1x Old\n${E}`,                                    // end
    `Above\n\n${B}\n1x Old\nunterminated block`,                      // missing END
    '   \n\n  ',
  ];
  for (const notes of corpora) {
    for (const entries of entrySets) {
      const once = applyMaybeboardBlock(notes, entries);
      const twice = applyMaybeboardBlock(once, entries);
      assert.equal(twice, once, `not idempotent for ${JSON.stringify(notes)} / ${entries.length} entries`);
    }
  }
});

test('apply: an unchanged remote leaves the notes exactly as they are', () => {
  const entries = [m('Pond', 2), m('Avatar of Fire', 1)];
  const notes = applyMaybeboardBlock('User text.', entries);
  assert.equal(applyMaybeboardBlock(notes, [m('Avatar of Fire', 1), m('Pond', 2)]), notes);
});
