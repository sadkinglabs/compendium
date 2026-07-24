// Pure tests for the alphabet-rail bounds. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railBounds } from './railGeometry.js';

const SAFE = 34;                       // a representative env(safe-area-inset-bottom)
const NAV_BASE = 62 + SAFE + 16;       // .cx-dock closed base: safe area lives here, ONCE

test('closed: bottom clears the nav base + stack + gap; safe area counted exactly once', () => {
  const b = railBounds({ scrollportTop: 0, headerHeight: 56, navBase: NAV_BASE, activeStackHeight: 40, railGap: 8 });
  assert.equal(b.top, 56);
  assert.equal(b.bottom, NAV_BASE + 40 + 8);            // 112 + 48
  // The safe area appears once (inside navBase) and is NOT appended again.
  assert.equal(b.bottom, 62 + SAFE + 16 + 40 + 8);
});

test('keyboard-open: the keyboard branch wins and does NOT re-add safe area', () => {
  const b = railBounds({ headerHeight: 56, navBase: NAV_BASE, activeStackHeight: 40, kb: 400, uiScale: 1, keyboardGap: 12, railGap: 8 });
  const dockBottom = 400 / 1 + 12;                      // 412 > navBase
  assert.equal(b.bottom, dockBottom + 40 + 8);
  // No safe-area double-count: the open-keyboard inset already represents the usable viewport.
  assert.ok(b.bottom < NAV_BASE + 400 + SAFE, 'safe area is not stacked above the keyboard inset');
});

test('UI scale divides the keyboard inset, as in .cx-dock', () => {
  const b = railBounds({ navBase: NAV_BASE, kb: 400, uiScale: 2, keyboardGap: 12, activeStackHeight: 0, railGap: 8 });
  const dockBottom = Math.max(NAV_BASE, 400 / 2 + 12);  // max(112, 212) = 212
  assert.equal(b.bottom, dockBottom + 0 + 8);
});

test('selection stack raises the bottom terminus by the action-bar height', () => {
  const closed = railBounds({ navBase: NAV_BASE, activeStackHeight: 40, railGap: 8 });
  const selecting = railBounds({ navBase: NAV_BASE, activeStackHeight: 40 + 72, railGap: 8 });   // + action bar
  assert.equal(selecting.bottom - closed.bottom, 72);
});

test('top is scrollport top + this surface header (drill header taller than ALL toolbar)', () => {
  const all = railBounds({ scrollportTop: 0, headerHeight: 44, navBase: NAV_BASE });
  const drill = railBounds({ scrollportTop: 0, headerHeight: 88, navBase: NAV_BASE });
  assert.equal(all.top, 44);
  assert.equal(drill.top, 88);
});

test('degenerate uiScale is treated as 1 (never divides by zero)', () => {
  const b = railBounds({ navBase: NAV_BASE, kb: 300, uiScale: 0, keyboardGap: 12 });
  assert.equal(b.bottom, Math.max(NAV_BASE, 300 + 12) + 8);
});
