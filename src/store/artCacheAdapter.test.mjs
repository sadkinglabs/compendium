// The REAL download orchestration in makeArtIo (src/store/artCacheAdapter.js), driven by fake Filesystem
// + CapacitorHttp so the fallback DECISION - not a replica - is proven: exact size skips HTTP, a
// truncated/thrown downloadFile really invokes HTTP, an HTTP non-2xx or wrong-decoded-size result is
// rejected and never left behind. (Codex Phase-2a Major 1.) Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeArtIo } from './artCacheAdapter.js';

const URL = 'https://cdn/k.webp';
const PATH = 'art-tmp/k.tmp';
const BYTES = 100;
const b64 = (n) => Buffer.alloc(n).toString('base64');   // base64 whose DECODED length is n

// dl: per-url downloadFile behaviour { size } | { throw:true }. httpGet: a fake CapacitorHttp.get, or
// null to simulate no plugin. Tracks whether HTTP was consulted.
function setup({ dl = {}, httpGet = null } = {}) {
  const files = new Map();
  const ops = [];
  let httpCalls = 0;
  const fs = {
    mkdir: async () => { ops.push('mkdir'); },
    stat: async ({ path }) => { if (!files.has(path)) throw new Error('ENOENT'); return { size: files.get(path) }; },
    downloadFile: async ({ url, path }) => { ops.push('downloadFile'); const s = dl[url]; if (s?.throw) throw new Error('dl fail'); files.set(path, s?.size ?? 0); return { path }; },
    writeFile: async ({ path, data }) => { ops.push('writeFile'); files.set(path, Buffer.from(data, 'base64').length); return { uri: 'u' }; },
    deleteFile: async ({ path }) => { ops.push('delete'); files.delete(path); },
  };
  const getHttp = () => (httpGet ? { get: async (a) => { httpCalls++; return httpGet(a); } } : null);
  const io = makeArtIo({ fs, getHttp, dir: 'DATA' });
  return { io, files, ops, httpCalls: () => httpCalls };
}

test('exact downloadFile result skips HTTP entirely', async () => {
  const s = setup({ dl: { [URL]: { size: BYTES } }, httpGet: () => { throw new Error('HTTP must not be called'); } });
  assert.equal(await s.io.download(URL, PATH, BYTES), true);
  assert.equal(s.httpCalls(), 0, 'HTTP was not consulted');
  assert.ok(!s.ops.includes('writeFile'));
  assert.equal(s.files.get(PATH), BYTES);
});

test('a TRUNCATED nonzero downloadFile invokes HTTP and succeeds on an exact HTTP body', async () => {
  const s = setup({ dl: { [URL]: { size: 50 } }, httpGet: () => ({ status: 200, data: b64(BYTES) }) });
  assert.equal(await s.io.download(URL, PATH, BYTES), true);
  assert.equal(s.httpCalls(), 1, 'HTTP really ran despite a nonzero downloadFile');
  assert.deepEqual(s.ops.filter((o) => o === 'delete' || o === 'writeFile'), ['delete', 'writeFile']);
  assert.equal(s.files.get(PATH), BYTES);
});

test('a THROWN downloadFile also falls through to HTTP', async () => {
  const s = setup({ dl: { [URL]: { throw: true } }, httpGet: () => ({ status: 200, data: b64(BYTES) }) });
  assert.equal(await s.io.download(URL, PATH, BYTES), true);
  assert.equal(s.httpCalls(), 1);
});

test('truncated downloadFile + no HTTP plugin returns false and leaves nothing behind', async () => {
  const s = setup({ dl: { [URL]: { size: 50 } }, httpGet: null });
  assert.equal(await s.io.download(URL, PATH, BYTES), false);
  assert.ok(!s.files.has(PATH), 'the truncated temp was removed');
});

test('an HTTP 404/500 body is rejected - never written or promoted', async () => {
  for (const status of [404, 500]) {
    const s = setup({ dl: { [URL]: { throw: true } }, httpGet: () => ({ status, data: b64(BYTES) }) });
    assert.equal(await s.io.download(URL, PATH, BYTES), false);
    assert.ok(!s.ops.includes('writeFile'), `status ${status}: no write`);
    assert.ok(!s.files.has(PATH));
  }
});

test('an HTTP 200 with the WRONG decoded size is rejected and cleaned up', async () => {
  const s = setup({ dl: { [URL]: { throw: true } }, httpGet: () => ({ status: 200, data: b64(99) }) });   // 99 != 100
  assert.equal(await s.io.download(URL, PATH, BYTES), false);
  assert.ok(!s.files.has(PATH), 'the wrong-size fallback write was removed');
});

test('a THROWN HTTP get is caught, returns false, and removes any partial', async () => {
  const s = setup({ dl: { [URL]: { size: 50 } }, httpGet: () => { throw new Error('net'); } });
  assert.equal(await s.io.download(URL, PATH, BYTES), false);
  assert.ok(!s.files.has(PATH));
});
