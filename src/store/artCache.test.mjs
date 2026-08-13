// The art cache core (src/store/artCache.js) - proved without Capacitor or a DOM via a fake in-memory
// io with per-op gates for the concurrency interleavings. Covers the load-bearing safety properties
// Codex named: fail-closed size validation (real assertions, not `|| true`), the promotion-lock
// linearization vs clear(), the non-repopulating staleResult, identity-safe inflight cleanup, and that
// every adapter failure settles resolve() without rejection. Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArtCache } from './artCache.js';

const KEY = '001-a-b-s.' + 'a'.repeat(64) + '.webp';
const KEY2 = '002-b-b-s.' + 'b'.repeat(64) + '.webp';
const GHOST = 'ghost.' + 'c'.repeat(64) + '.webp';   // not in the manifest
const REMOTE = (k) => `https://cdn/${k}`;
const MF = {
  objects: {
    '001-a-b-s': { key: KEY, bytes: 100 },
    '002-b-b-s': { key: KEY2, bytes: 200 },
  },
};
// `art`: preseeded cached files {relpath:size}. `remote`: mutable per-URL download spec {ok,size,lie?}.
// MILESTONE gates (per Codex): `fake.gate(op)` installs a one-shot gate for the NEXT call to that op and
// returns { entered, release() }. A test awaits `gate.entered` (the op is provably in-flight) before it
// interleaves clear(), then calls release() - no timers, so a test named "clear DURING op" cannot drift
// into "clear before op". Multiple gate(op) calls queue FIFO (one per invocation).
function fakeIo({ art = {}, remote = {} } = {}) {
  const files = new Map(Object.entries(art).map(([p, size]) => [p, { size }]));
  const ops = [];
  const gateQueues = {};
  const wait = async (op) => { const q = gateQueues[op]; if (q && q.length) return q.shift().wait(); };
  const gate = (op) => {
    let markEntered, release;
    const entered = new Promise((r) => { markEntered = r; });
    const blocked = new Promise((r) => { release = r; });
    const g = { entered, release: () => release(), wait() { markEntered(); return blocked; } };
    (gateQueues[op] ||= []).push(g);
    return g;
  };
  const io = {
    stat: async (p) => { ops.push(`stat ${p}`); await wait('stat'); const f = files.get(p); return f ? { size: f.size } : null; },
    size: async (p) => { ops.push(`size ${p}`); return files.get(p)?.size ?? 0; },
    download: async (url, path, expectedBytes) => {
      ops.push(`download ${url}`); await wait('download');
      const r = remote[url];
      if (!r || !r.ok) return false;
      files.set(path, { size: r.size });
      return r.lie ? true : r.size === expectedBytes;   // lie:true simulates an adapter that wrongly reports success
    },
    rename: async (from, to) => { ops.push(`rename ${to}`); await wait('rename'); const f = files.get(from); files.delete(from); files.set(to, f); },
    delete: async (p) => { ops.push(`delete ${p}`); files.delete(p); },
    deleteTree: async (dir) => { ops.push(`deleteTree ${dir}`); for (const k of [...files.keys()]) if (k === dir || k.startsWith(dir + '/')) files.delete(k); },
    list: async (dir) => [...files.entries()].filter(([k]) => k.startsWith(dir + '/')).map(([k, v]) => ({ name: k.slice(dir.length + 1), size: v.size })),
  };
  return { io, files, ops, remote, gate };
}

let seq = 0;
const make = (over = {}) => {
  const f = over.fake || fakeIo();
  const cache = createArtCache({
    io: over.io || f.io, manifest: MF,
    isNative: over.isNative ?? (() => true),
    imagesDisabled: over.imagesDisabled ?? (() => false),
    remoteUrl: REMOTE,
    convertFileSrc: (rel) => `cap://${rel}`,
    rand: () => `t${seq++}`,
  });
  return { cache, f };
};
const remoteCand = (k) => ({ kind: 'remote', src: REMOTE(k) });
const localCand = (k) => ({ kind: 'local', src: `cap://art/${k}` });

test('web: resolve returns the remote candidate and touches NO filesystem', async () => {
  const { cache, f } = make({ isNative: () => false });
  assert.deepEqual(await cache.resolve(KEY), remoteCand(KEY));
  assert.equal(f.ops.length, 0);
  assert.deepEqual(cache.peek(KEY), remoteCand(KEY), 'web peek is flash-free remote');
});

test('zero-image: resolve/download/peek all return null and do NO io', async () => {
  const { cache, f } = make({ imagesDisabled: () => true });
  assert.equal(await cache.resolve(KEY), null);
  assert.equal(await cache.download(KEY), false);
  assert.equal(cache.peek(KEY), null);
  assert.equal(f.ops.length, 0, 'zero-image prohibits I/O, not just render');
});

test('native cache HIT (exact size) returns the local candidate and memoizes it', async () => {
  const { cache } = make({ fake: fakeIo({ art: { [`art/${KEY}`]: 100 } }) });
  assert.deepEqual(await cache.resolve(KEY), localCand(KEY));
  assert.deepEqual(cache.peek(KEY), localCand(KEY));
});

test('native MISS: downloads, validates exact size, promotes under the lock, returns local', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } }) });
  assert.deepEqual(await cache.resolve(KEY), localCand(KEY));
  assert.ok(f.ops.includes(`rename art/${KEY}`), 'promoted via rename');
});

test('a wrong-size download is not promoted; degrades to remote; temp cleaned', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 99 } } }) });
  assert.deepEqual(await cache.resolve(KEY), remoteCand(KEY));
  assert.ok(!f.files.has(`art/${KEY}`));
  assert.ok(![...f.files.keys()].some((k) => k.startsWith('art-tmp/')), 'temp cleaned');
});

test('DEFENCE IN DEPTH: the core rejects a wrong-size file even if the adapter wrongly reports success', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 99, lie: true } } }) });
  assert.deepEqual(await cache.resolve(KEY), remoteCand(KEY), 'validSize catches the lie');
  assert.ok(!f.files.has(`art/${KEY}`), 'never promoted');
});

test('FAIL CLOSED: an unknown-manifest key is DELETED and never downloaded or promoted', async () => {
  const fake = fakeIo({ art: { [`art/${GHOST}`]: 100 }, remote: { [REMOTE(GHOST)]: { ok: true, size: 100 } } });
  const { cache } = make({ fake });
  assert.deepEqual(await cache.resolve(GHOST), remoteCand(GHOST));
  assert.ok(!fake.files.has(`art/${GHOST}`), 'the untrusted cached bytes were removed');   // fails if the delete is removed
  assert.ok(!fake.ops.some((o) => o === `download ${REMOTE(GHOST)}`), 'an undescribed key is never downloaded');
});

test('a FAILED download is not memoized; a later resolve retries and succeeds', async () => {
  const fake = fakeIo({ remote: { [REMOTE(KEY)]: { ok: false } } });
  const { cache } = make({ fake });
  assert.deepEqual(await cache.resolve(KEY), remoteCand(KEY));
  assert.equal(cache._debug.resolved.size, 0, 'a miss is never memoized');
  fake.remote[REMOTE(KEY)] = { ok: true, size: 100 };   // the object appears
  assert.deepEqual(await cache.resolve(KEY), localCand(KEY), 'the retry downloads and promotes');
});

test('single-flight: two concurrent resolves for one key share ONE download', async () => {
  const { cache, f } = make({ fake: fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } }) });
  const [a, b] = await Promise.all([cache.resolve(KEY), cache.resolve(KEY)]);
  assert.deepEqual(a, b);
  assert.equal(f.ops.filter((o) => o.startsWith('download ')).length, 1);
});

test('LINEARIZATION: clear() during a DOWNLOAD leaves the cache empty (staleResult, no repopulation)', async () => {
  const fake = fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } });
  const g = fake.gate('download');
  const { cache } = make({ fake });
  const p = cache.resolve(KEY);
  await g.entered;                // the download is provably in-flight
  await cache.clear();
  g.release();
  assert.deepEqual(await p, remoteCand(KEY));
  assert.ok(!fake.files.has(`art/${KEY}`), 'the promote no-opped: cleared cache stays empty');
  assert.equal(cache._debug.resolved.size, 0);
});

test('clear() during an existing-file STAT cannot return or memoize the deleted local uri', async () => {
  const fake = fakeIo({ art: { [`art/${KEY}`]: 100 } });   // a valid cached file
  const g = fake.gate('stat');
  const { cache } = make({ fake });
  const p = cache.resolve(KEY);
  await g.entered;                // parked in stat
  await cache.clear();            // deletes art/KEY and bumps epoch while stat is parked
  g.release();
  assert.deepEqual(await p, remoteCand(KEY), 'the cleared flight degrades to remote, not the stale local');
  assert.equal(cache._debug.resolved.size, 0, 'never memoized');
});

test('a promotion holding the lock completes first, THEN clear() removes the file; no stale memo', async () => {
  const fake = fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } });
  const g = fake.gate('rename');
  const { cache } = make({ fake });
  const p = cache.resolve(KEY);
  await g.entered;                // parked in rename, holding the promotion lock
  const clearP = cache.clear();   // epoch++, its deleteTree queues behind the held lock
  g.release();                    // rename completes -> lock releases -> clear's deleteTree runs
  await clearP; await p;
  assert.ok(!fake.files.has(`art/${KEY}`), 'clear removed the file AFTER the promote completed');
  assert.equal(cache._debug.resolved.size, 0, 'a stale-epoch promote did not memoize');
});

test("an old flight's finally cannot evict a newer same-key inflight entry", async () => {
  const fake = fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } });
  const g1 = fake.gate('download'); const g2 = fake.gate('download');   // one per flight, FIFO
  const { cache } = make({ fake });
  const p1 = cache.resolve(KEY);
  await g1.entered;               // flight1 parked in download
  await cache.clear();            // epoch++, inflight.clear()
  const p2 = cache.resolve(KEY);
  await g2.entered;               // flight2 (new epoch) parked in download
  g1.release();
  await p1;                       // flight1 fully settles (stale-epoch); its finally must NOT delete flight2's entry
  assert.equal(cache._debug.inflight.has(KEY), true, 'flight2 inflight entry survived flight1 finally');
  g2.release();
  await Promise.all([p1, p2]);
  assert.equal(cache._debug.inflight.has(KEY), false, 'both flights cleaned up their OWN entries');
});

test('every adapter failure point settles resolve() without rejecting', async () => {
  const throwing = (op) => {
    const base = { stat: async () => null, size: async () => 0, download: async () => false, rename: async () => {}, delete: async () => {}, deleteTree: async () => {}, list: async () => [] };
    return { ...base, [op]: async () => { throw new Error(`${op} boom`); } };
  };
  for (const op of ['stat', 'download', 'size', 'rename']) {
    const { cache } = make({ io: throwing(op) });
    assert.deepEqual(await cache.resolve(KEY), remoteCand(KEY), `${op} failure degrades to remote, never rejects`);
  }
});

test('scratch orphans are swept on sweepScratch() and on clear()', async () => {
  const fake = fakeIo({ art: { 'art-tmp/orphan.tmp': 5, [`art/${KEY}`]: 100 } });
  const { cache } = make({ fake });
  await cache.sweepScratch();
  assert.ok(!fake.files.has('art-tmp/orphan.tmp'), 'sweepScratch removed the orphan');
  fake.files.set('art-tmp/orphan2.tmp', { size: 5 });
  await cache.clear();
  assert.ok(!fake.files.has('art-tmp/orphan2.tmp'), 'clear() also sweeps scratch');
  assert.ok(!fake.files.has(`art/${KEY}`), 'clear() removed art/ too');
});

test('quarantine: first offence deletes + re-resolves (fresh); repeat offence returns remote, no download', async () => {
  const fake = fakeIo({ art: { [`art/${KEY}`]: 100 }, remote: { [REMOTE(KEY)]: { ok: true, size: 100 } } });
  const { cache } = make({ fake });
  await cache.resolve(KEY);
  const first = await cache.quarantine(KEY);
  assert.equal(first.kind, 'local');
  const dloads = fake.ops.filter((o) => o.startsWith('download ')).length;
  const second = await cache.quarantine(KEY);
  assert.deepEqual(second, remoteCand(KEY));
  assert.equal(fake.ops.filter((o) => o.startsWith('download ')).length, dloads, 'no further download on repeat');
});

test('stats: files/bytes/scratch and manifest-computed completeness', async () => {
  const fake = fakeIo({ art: { [`art/${KEY}`]: 100 } });
  const { cache } = make({ fake });
  let s = await cache.stats();
  assert.deepEqual({ files: s.files, bytes: s.bytes, complete: s.complete }, { files: 1, bytes: 100, complete: false });
  fake.files.set(`art/${KEY2}`, { size: 200 });
  s = await cache.stats();
  assert.equal(s.complete, true);
});

test('downloadAll: bounded, epoch-aware, reports progress', async () => {
  const fake = fakeIo({ remote: { [REMOTE(KEY)]: { ok: true, size: 100 }, [REMOTE(KEY2)]: { ok: true, size: 200 } } });
  const { cache } = make({ fake });
  const seen = [];
  const res = await cache.downloadAll([KEY, KEY2], { onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(res, { done: 2, total: 2, stopped: false });
  assert.deepEqual(seen.at(-1), [2, 2]);
});

/* ------------------------------------------------------------------ */
/* Boot seeding - the cold-index fix (art-first-paint Increment 1)     */
/* ------------------------------------------------------------------ */

test('seedFromDisk warms peek() for exact-size files, and ONLY those', async () => {
  const { cache } = make({ fake: fakeIo({ art: {
    [`art/${KEY}`]: 100,      // exact manifest size -> seeded
    [`art/${KEY2}`]: 150,     // manifest says 200 -> NOT seeded (truncated/corrupt)
    [`art/${GHOST}`]: 300,    // not in the manifest -> NOT seeded, fail closed
  } }) });
  assert.equal(cache.peek(KEY), null, 'precondition: the memo starts cold');

  const n = await cache.seedFromDisk();

  assert.equal(n, 1, 'exactly the one valid file is admitted');
  assert.deepEqual(cache.peek(KEY), localCand(KEY), 'a seeded key answers peek synchronously');
  assert.equal(cache.peek(KEY2), null, 'a size mismatch is left for resolve() to delete and re-fetch');
  assert.equal(cache.peek(GHOST), null, 'a key the manifest cannot describe is never served');
});

test('seedFromDisk does NOTHING on web or under zero-image - not even the directory list', async () => {
  for (const over of [{ isNative: () => false }, { imagesDisabled: () => true }]) {
    const f = fakeIo({ art: { [`art/${KEY}`]: 100 } });
    const { cache } = make({ ...over, fake: f });
    assert.equal(await cache.seedFromDisk(), 0);
    assert.equal(f.ops.length, 0, 'no io at all');
  }
});

test('a clear() DURING the seeding list wins: nothing repopulates the wiped memo', async () => {
  const f = fakeIo({ art: { [`art/${KEY}`]: 100 } });
  // Gate the list call so clear() can be interleaved while it is provably in flight.
  const origList = f.io.list;
  let release; const held = new Promise((r) => { release = r; });
  f.io.list = async (dir) => { const p = origList(dir); await held; return p; };
  const { cache } = make({ fake: f });

  const seeding = cache.seedFromDisk();
  await cache.clear();
  release();
  assert.equal(await seeding, 0, 'the stale listing must not seed the new epoch');
  assert.equal(cache.peek(KEY), null);
});

/* ------------------------------------------------------------------ */
/* The painted registry - the no-refade half                           */
/* ------------------------------------------------------------------ */

test('painted is marked, read, and evicted by quarantine and clear', async () => {
  const { cache } = make({ fake: fakeIo({ art: { [`art/${KEY}`]: 100, [`art/${KEY2}`]: 200 } }) });
  assert.equal(cache.hasPainted(KEY), false, 'nothing is painted at boot');

  cache.markPainted(KEY);
  cache.markPainted(KEY2);
  assert.equal(cache.hasPainted(KEY), true);

  // Quarantine evicts THAT key only: its re-download is a first load again and must shimmer.
  await cache.quarantine(KEY);
  assert.equal(cache.hasPainted(KEY), false, 'a quarantined key must not skip the shimmer');
  assert.equal(cache.hasPainted(KEY2), true, 'other keys keep their painted status');

  // clear() evicts everything: post-clear loads are first loads.
  await cache.clear();
  assert.equal(cache.hasPainted(KEY2), false, 'a cache clear resets the no-refade state');
});

test('markPainted ignores a null key rather than growing the set', async () => {
  const { cache } = make({});
  cache.markPainted(null);
  cache.markPainted(undefined);
  assert.equal(cache._debug.painted.size, 0);
});
