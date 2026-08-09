// Fail-closed proof for the DESIGN_SYSTEM.md governance requirement.
// Cross-platform + deterministic: uses a temp fixture root (no chmod / permission tricks).
// Wired into the gate via `npm run check:docs` (see package.json), mirroring check:types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkDocs } from './check-docs.mjs';

const REQUIRED = [
  'AGENTS.md',
  'ENGINEERING_CONSTITUTION.md',
  'BUILD.md',
  'DESIGN_SYSTEM.md',
  'COMPENDIUM_ARCHITECTURE.md',
  'COMPENDIUM_DATA_MODEL.md',
  'COMPENDIUM_FEATURE_MATRIX.md',
];

async function fixture(names) {
  const root = await mkdtemp(path.join(tmpdir(), 'checkdocs-'));
  for (const name of names) await writeFile(path.join(root, name), '# stub\n', 'utf8');
  return root;
}

const missesDesignSystem = (failures) =>
  failures.some((f) => f.includes('DESIGN_SYSTEM.md') && /cannot be read/.test(f));

test('present: DESIGN_SYSTEM.md exists → no missing-file failure for it', async () => {
  const root = await fixture(REQUIRED);
  try {
    const { failures } = await checkDocs(root);
    assert.equal(missesDesignSystem(failures), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing: DESIGN_SYSTEM.md absent → fails closed', async () => {
  const root = await fixture(REQUIRED.filter((n) => n !== 'DESIGN_SYSTEM.md'));
  try {
    const { failures } = await checkDocs(root);
    assert.equal(missesDesignSystem(failures), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Regression: .venv (e.g. a pip-installed package's own Markdown with broken relative links) must NOT be
// scanned, while ordinary repo docs still are. Guards the check-docs.mjs skip-list entry for '.venv'.
const brokenLinkIn = (failures, needle) =>
  failures.some((f) => f.includes(needle) && /broken local link/.test(f));

test('.venv Markdown is ignored while ordinary docs are still scanned', async () => {
  const root = await fixture(REQUIRED);
  try {
    await writeFile(path.join(root, 'ordinary.md'), '[x](./does-not-exist.md)\n', 'utf8');
    await mkdir(path.join(root, '.venv', 'Lib', 'site-packages', 'pkg'), { recursive: true });
    await writeFile(path.join(root, '.venv', 'Lib', 'site-packages', 'pkg', 'Privacy.md'),
      '[y](../also-missing.md)\n', 'utf8');
    const { failures } = await checkDocs(root);
    assert.equal(brokenLinkIn(failures, 'ordinary.md'), true, 'ordinary doc broken link should be reported');
    assert.equal(brokenLinkIn(failures, '.venv'), false, '.venv Markdown must be ignored');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
