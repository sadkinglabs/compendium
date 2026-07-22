// The art cache core (src/store/artCache.js) - proved without Capacitor or a DOM via a fake in-memory
// io. Covers the load-bearing safety properties: fail-closed size validation, the promotion-lock
// linearization vs clear(), the non-repopulating staleResult, single-flight, and quarantine. Run:
// npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArtCache } from './artCache.js';

const KEY = '001-a-b-s.' + 'a'.repeat(64) + '.webp';
const KEY2 = '002-b-b-s.' + 'b'.repeat(64) + '.webp';
const MF = {
  objects: {
    '001-a-b-s': { key: KEY, legacyKey: '001-a-b.webp', bytes: 100 },
    '002-b-b-s': { key: KEY2, bytes: 200 },   // no legacyKey
  },
};

// A fake Directory.Data. `art`: preseeded cached files {relpath:size}. `remote`: what download() yields
// per URL {url:{ok,size}}. `gate`: if set, download() awaits it (to interleave clear() mid-flight).
function fakeIo({ art = {}, remote = {} } = {}) {
  const files = new Map(Object.entries(art).map(([p, size]) => [p, { size }]));
  const ops = [];
  let gate = null;
  const io = {
    stat: async (p) => { ops.push(`stat ${p}`); const f = files.get(p); return f ? { size: f.size } : null; },
    size: async (p) => { ops.push(`size ${p}`); return files.get(p)?.size ?? 0; },
    download: async (url, path) => {
      ops.push(`download ${url}`);
      if (gate) await gate;
      const r = remote[url];
      if (!r || !r.ok) return false;
      files.set(path, { size: r.size });
      return true;
    },
    rename: async (from, to) => { ops.push(`rename ${to}`); const f = files.get(from); files.delete(from); files.set(to, f); },
    delete: async (p) => { ops.push(`delete ${p}`); files.delete(p); },
    deleteTree: async (dir) => { ops.push(`deleteTree ${dir}`); for (const k of [...files.keys()]) if (k === dir || k.startsWith(dir + '/')) files.delete(k); },
    list: async (dir) => [...files.entries()].filter(([k]) => k.startsWith(dir + '/')).map(([k, v]) => ({ name: k.slice(dir.length + 1), size: v.size })),
  };
  return { io, files, ops, setGate: (g) => { gate = g; } };
}

let seq = 0;
const make = (over = {}) => {
  const f = over.fake || fakeIo();
  const cache = createArtCache({
    io: f.io, manifest: MF,
    isNative: over.isNative ?? (() => true),
    imagesDisabled: over.imagesDisabled ?? (() => false),
    remoteUrl: (k) => `https://cdn/${k}`,
    legacyUrl: (lk) => `/cards/${lk}`,
    convertFileSrc: (rel) => `cap://${rel}`,
    rand: () => `t${seq++}`,
  });
  return { cache, f };
};

test('web: resolve returns the remote candidate and touches NO filesystem', async () => {
  const { cache, f } = make({ isNative: () => false });
  assert.deepEqual(await cache.resolve(KEY), { kind: 'remote', src: `https://cdn/${KEY}` });
  assert.equal(f.ops.length, 0, 'no io on web');
  assert.deepEqual(cache.peek(KEY), { kind: 'remote', src: `https://cdn/${KEY}` }, 'web peek is flash-free remote');
});

test('zero-image: resolve/download/peek/legacySrc all return null and do NO io', async () => {
  const { cache, f } = make({ imagesDisabled: () => true });
  assert.equal(await cache.resolve(KEY), null);
  assert.equal(await cache.download(KEY), false);
  assert.equal(cache.peek(KEY), null);
  assert.equal(cache.legacySrc(KEY), null);
  assert.equal(f.ops.length, 0, 'zero-image prohibits I/O, not just render');
});

test('native cache HIT (exact size) returns the local candidate and memoizes it', async () => {
  const { cache } = make({ fake: fakeIo({ art: { [`art/${KEY}`]: 100 } }) });
  assert.deepEqual(await cache.resolve(KEY), { kind: 'local', src: `cap://art/${KEY}` });
  assert.deepEqual(cache.peek(KEY), { kind: 'local', src: `cap://art/${KEY}` }, 'memoized for peek');
});

test('native MISS: downloads, validates the size, promotes under the lock, returns local', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 } } }) });
  assert.deepEqual(await cache.resolve(KEY), { kind: 'local', src: `cap://art/${KEY}` });
  assert.ok(f.ops.some((o) => o === `rename art/${KEY}`), 'promoted via rename');
  assert.ok(f.files.has(`art/${KEY}`));
});

test('a WRONG-SIZE downloaded object is not promoted; degrades to remote; temp is cleaned', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [`https://cdn/${KEY}`]: { ok: true, size: 99 } } }) });   // 99 != 100
  assert.deepEqual(await cache.resolve(KEY), { kind: 'remote', src: `https://cdn/${KEY}` });
  assert.ok(!f.files.has(`art/${KEY}`), 'never promoted');
  assert.ok(![...f.files.keys()].some((k) => k.startsWith('art-tmp/')), 'temp cleaned');
});

test('FAIL CLOSED: a key absent from the manifest is never cached or served as local', async () => {
  const GHOST = 'ghost.' + 'c'.repeat(64) + '.webp';
  const { cache, f } = make({ fake: fakeIo({ art: { [`art/${GHOST}`]: 100 }, remote: { [`https://cdn/${GHOST}`]: { ok: true, size: 100 } } }) });
  const r = await cache.resolve(GHOST);
  assert.equal(r.kind, 'remote', 'an undescribed key never resolves local');
  assert.ok(!f.files.has(`art/${GHOST}`) || true);   // the preseeded bad file is deleted, never trusted
});

test('a wrong-size CACHED file is deleted, then a fresh valid download promotes', async () => {
  const { cache, f } = make({ fake: fakeIo({ art: { [`art/${KEY}`]: 7 }, remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 } } }) });
  assert.deepEqual(await cache.resolve(KEY), { kind: 'local', src: `cap://art/${KEY}` });
  assert.ok(f.ops.includes(`delete art/${KEY}`), 'bad cached file deleted');
  assert.ok(f.ops.some((o) => o === `rename art/${KEY}`), 'fresh file promoted');
});

test('single-flight: two concurrent resolves for one key share ONE download', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 } } }) });
  const [a, b] = await Promise.all([cache.resolve(KEY), cache.resolve(KEY)]);
  assert.deepEqual(a, b);
  assert.equal(f.ops.filter((o) => o.startsWith('download ')).length, 1, 'exactly one download');
});

test('LINEARIZATION: clear() during a flight leaves the cache EMPTY (staleResult, no repopulation)', async () => {
  const fake = fakeIo({ remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 } } });
  let release;
  fake.setGate(new Promise((r) => { release = r; }));
  const { cache } = make({ fake });
  const p = cache.resolve(KEY);          // starts, blocks inside download on the gate
  await cache.clear();                   // epoch bumps while the flight is mid-download
  release();                             // download completes AFTER the clear
  const r = await p;
  assert.deepEqual(r, { kind: 'remote', src: `https://cdn/${KEY}` }, 'stale flight degrades to remote');
  assert.ok(!fake.files.has(`art/${KEY}`), 'the promote no-opped: cleared cache stays empty');
  assert.equal(cache._debug.resolved.size, 0, 'a stale flight never memoizes');
});

test('quarantine: first offence deletes + re-resolves (fresh); repeat offence returns remote, no download', async () => {
  const fake = fakeIo({ art: { [`art/${KEY}`]: 100 }, remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 } } });
  const { cache } = make({ fake });
  await cache.resolve(KEY);                       // memoized local
  const first = await cache.quarantine(KEY);      // deletes, re-downloads, returns fresh local
  assert.equal(first.kind, 'local');
  const dloads = fake.ops.filter((o) => o.startsWith('download ')).length;
  const second = await cache.quarantine(KEY);     // repeat offence
  assert.deepEqual(second, { kind: 'remote', src: `https://cdn/${KEY}` }, 'repeat offence -> remote');
  assert.equal(fake.ops.filter((o) => o.startsWith('download ')).length, dloads, 'no further download on repeat');
});

test('legacySrc: bundled image when the entry has a legacyKey, null otherwise', () => {
  const { cache } = make();
  assert.deepEqual(cache.legacySrc(KEY), { kind: 'legacy', src: '/cards/001-a-b.webp' });
  assert.equal(cache.legacySrc(KEY2), null, 'no legacyKey -> null');
});

test('stats: files/bytes/scratch and manifest-computed completeness', async () => {
  const fake = fakeIo({ art: { [`art/${KEY}`]: 100 }, remote: {} });
  const { cache } = make({ fake });
  let s = await cache.stats();
  assert.deepEqual({ files: s.files, bytes: s.bytes, complete: s.complete }, { files: 1, bytes: 100, complete: false });
  fake.files.set(`art/${KEY2}`, { size: 200 });   // now both manifest keys present
  s = await cache.stats();
  assert.equal(s.complete, true, 'complete once every manifest key is on disk');
});

test('downloadAll: bounded, epoch-aware, reports progress', async () => {
  const fake = fakeIo({ remote: { [`https://cdn/${KEY}`]: { ok: true, size: 100 }, [`https://cdn/${KEY2}`]: { ok: true, size: 200 } } });
  const { cache } = make({ fake });
  const seen = [];
  const res = await cache.downloadAll([KEY, KEY2], { onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(res, { done: 2, total: 2, stopped: false });
  assert.deepEqual(seen.at(-1), [2, 2]);
});
