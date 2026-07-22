// The one module that owns every byte of card art the app touches - resolving, caching, downloading,
// validating, clearing. A pure core over an injected `io` adapter (the only native-touching code lives
// in the adapter, wired in native.js), so single-flight, epoch, the promotion lock, and quarantine are
// unit-testable without Capacitor or a DOM. Run: npm run test:query
//
// Implements the approved design in docs/proposals/art-cdn-rev2-architecture.md Section B (B2 interface,
// B3 resolution, B3.5 candidate chain, B6 zero-image, B7 clear/stats). The load-bearing invariants:
//
//   - ZERO-IMAGE prohibits BOTH render AND I/O: resolve/download/peek/legacySrc all return null when
//     imagesDisabled(), at the top, before any Filesystem call (B6).
//   - LINEARIZATION: every write into art/ (a rename or a delete) happens inside a short promotion lock
//     with the request's epoch re-checked INSIDE the lock; the network download is never under the lock.
//   - NO CACHE-REPOPULATION AFTER clear(): a flight whose epoch was invalidated mid-air terminates in a
//     NON-CACHING staleResult() - it never memoizes, never downloads, never re-enters resolve(). Only a
//     genuinely new request under the new epoch may refill the cache.
//   - EXACT-SIZE VALIDATION, FAIL CLOSED: a cached file is trusted only if its byte count equals the
//     manifest's, and a key absent from the manifest is never cached or served.
//
// Sources are KIND-TAGGED { kind:'local'|'remote'|'legacy', src } - never bare strings (a native cached
// file becomes an https://localhost/_capacitor_file_/... URL a startsWith('http') sniff misreads).

const noop = () => {};

/**
 * @param deps.io          { stat(path)->{size}|null, download(url,path)->bool, size(path)->number,
 *                            rename(from,to), delete(path), deleteTree(path), list(dir)->[{name,size}] }
 *                          paths are relative to Directory.Data ('art/<key>', 'art-tmp/<key>.<rand>').
 * @param deps.manifest    { objects: { <slug>: { key, legacyKey?, bytes } } } - the shipped slim manifest
 * @param deps.isNative    () => boolean
 * @param deps.imagesDisabled () => boolean   (the zero-image gate; app-wide)
 * @param deps.remoteUrl   (key) => string    (ART_CDN_BASE + '/' + key)
 * @param deps.legacyUrl   (legacyKey) => string   (`${BASE}cards/${legacyKey}` - the ONE bundled path)
 * @param deps.convertFileSrc (relPath) => string  (Directory.Data-relative art path -> WebView src; the
 *                          adapter does Filesystem.getUri + Capacitor.convertFileSrc; identity in tests)
 * @param deps.rand        () => string        (unique temp suffix; injected for deterministic tests)
 */
export function createArtCache(deps) {
  const { io, manifest, isNative, imagesDisabled, remoteUrl, legacyUrl, convertFileSrc, rand } = deps;

  const inflight = new Map();   // key -> { epoch, promise }  (single-flight; joinable only within one epoch)
  const resolved = new Map();   // key -> {kind,src}          (session memo; feeds peek)
  const retried  = new Set();   // keys quarantined+retried once this session
  let   epoch    = 0;           // cache generation; clear() increments it
  let   promotionLock = Promise.resolve();   // serializes rename/delete ONLY, never a download

  const objectsOf = () => (manifest && manifest.objects) || {};
  // The slug is the key minus its `.<64hex>[.repair-n].webp` tail. Slugs contain no dots.
  const slugOf = (key) => String(key).replace(/\.[0-9a-f]{64}(\.repair-[1-9]\d*)?\.webp$/, '');
  const entryOf = (key) => {
    const e = objectsOf()[slugOf(key)];
    return e && e.key === key ? e : null;    // fail closed: a key the manifest can't describe is unknown
  };
  const validSize = (key, n) => { const e = entryOf(key); return !!e && n === e.bytes; };

  const remoteCand = (key) => ({ kind: 'remote', src: remoteUrl(key) });
  // The terminal answer for a flight whose epoch was invalidated, or a plain download miss: a
  // DISPLAY-ONLY candidate that is never memoized and never triggers I/O.
  const staleResult = (key) => (imagesDisabled() ? null : remoteCand(key));

  function withPromotionLock(fn) {
    const run = promotionLock.then(fn, fn);   // a promise-chain mutex, held for ONE rename or delete
    promotionLock = run.then(noop, noop);
    return run;
  }

  /** The bundled printing-base image, the Phase 2->5 offline fallback. Sync, gated, null when absent. */
  function legacySrc(key) {
    if (!key || imagesDisabled()) return null;
    const e = entryOf(key);
    return e && e.legacyKey ? { kind: 'legacy', src: legacyUrl(e.legacyKey) } : null;
  }

  /** Memoized prior resolution, for a flash-free first paint. Web is deterministic (remote); native
   *  returns the cached-local memo or null (which sends the hook to resolve()). */
  function peek(key) {
    if (!key || imagesDisabled()) return null;
    if (!isNative()) return remoteCand(key);
    return resolved.get(key) || null;
  }

  /** The ONLY art entry point. NEVER rejects: adapter failures degrade to staleResult. */
  function resolve(key) {
    if (!key || imagesDisabled()) return Promise.resolve(null);   // zero-image: no render, no I/O
    if (!isNative()) return Promise.resolve(remoteCand(key));     // web: the browser HTTP cache is the cache
    if (resolved.has(key)) return Promise.resolve(resolved.get(key));
    const existing = inflight.get(key);
    if (existing && existing.epoch === epoch) return existing.promise;   // join CURRENT-epoch flights only

    const reqEpoch = epoch;
    let tmp = null, promoted = false;
    const ent = { epoch: reqEpoch, promise: null };
    ent.promise = (async () => {
      try {
        const st = await io.stat(`art/${key}`);
        if (reqEpoch !== epoch) return staleResult(key);                 // cleared mid-stat
        if (st && validSize(key, st.size)) {
          const out = { kind: 'local', src: convertFileSrc(`art/${key}`) };
          resolved.set(key, out);
          return out;
        }
        if (st) await withPromotionLock(() => (reqEpoch === epoch ? io.delete(`art/${key}`) : null));
        if (reqEpoch !== epoch) return staleResult(key);                 // cleared while awaiting the delete

        tmp = `art-tmp/${key}.${rand()}`;                                // unique temp in the SCRATCH sibling
        const ok = await io.download(remoteUrl(key), tmp);
        const good = ok && validSize(key, await io.size(tmp));
        promoted = good && await withPromotionLock(async () => {
          if (reqEpoch !== epoch) return false;                         // THE linearization point
          await io.rename(tmp, `art/${key}`);
          return true;
        });
        if (!promoted) return staleResult(key);
        const out = { kind: 'local', src: convertFileSrc(`art/${key}`) };
        if (reqEpoch === epoch) resolved.set(key, out);
        return out;
      } catch {
        return staleResult(key);                                         // adapter failure: never unhandled-reject
      }
    })().finally(async () => {
      if (tmp && !promoted) await io.delete(tmp).catch(noop);            // temp cleanup on EVERY exit
      if (inflight.get(key) === ent) inflight.delete(key);              // evict only OUR entry
    });
    inflight.set(key, ent);
    return ent.promise;
  }

  /** Ensure the object is cached locally. No-op on web / zero-image. Shares resolve()'s single-flight. */
  async function download(key) {
    if (!key || imagesDisabled() || !isNative()) return false;
    const r = await resolve(key);
    return r != null && r.kind === 'local';
  }

  /** The offline pack (Phase 3 wires the Settings UI). Bounded concurrency, epoch-aware. */
  async function downloadAll(keys, { onProgress = noop, shouldStop = () => false, concurrency = 6 } = {}) {
    if (!isNative() || imagesDisabled()) return { done: 0, total: keys.length, stopped: true };
    const startEpoch = epoch;
    let done = 0, i = 0, stopped = false;
    const worker = async () => {
      while (i < keys.length) {
        if (shouldStop() || epoch !== startEpoch) { stopped = true; return; }
        const key = keys[i++];
        await download(key);
        done++; onProgress(done, keys.length);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, keys.length || 1)) }, worker));
    return { done, total: keys.length, stopped };
  }

  /** onError for a LOCAL candidate: delete + retry once (fresh download), then fall back to remote.
   *  Epoch-checked; a clear() during the locked delete yields staleResult without re-resolving. */
  async function quarantine(key) {
    if (!key || !isNative()) return staleResult(key);
    const reqEpoch = epoch;
    resolved.delete(key);
    await withPromotionLock(() => (reqEpoch === epoch ? io.delete(`art/${key}`).catch(noop) : null));
    if (reqEpoch !== epoch) return staleResult(key);
    if (!retried.has(key)) { retried.add(key); return resolve(key); }   // sanctioned refill (live decode error)
    return staleResult(key);                                            // repeat offence: remote, no more downloads
  }

  /** Bump the epoch, detach inflight + memos, delete art/ under the lock. A predating flight can no
   *  longer repopulate the cache (its promote sees the new epoch and no-ops). */
  async function clear() {
    epoch++;
    inflight.clear();
    resolved.clear();
    retried.clear();
    await withPromotionLock(() => io.deleteTree('art').catch(noop));
  }

  /** files/bytes count art/ alone; scratchBytes reports art-tmp/ so Settings never claims "empty" while
   *  a temp is in flight; complete is computed against the manifest keys, NEVER a stamp. */
  async function stats() {
    const art = await io.list('art').catch(() => []);
    const scratch = await io.list('art-tmp').catch(() => []);
    const bytes = art.reduce((n, f) => n + (f.size || 0), 0);
    const scratchBytes = scratch.reduce((n, f) => n + (f.size || 0), 0);
    const have = new Set(art.map((f) => f.name));
    const wantKeys = Object.values(objectsOf()).map((e) => e.key);
    const complete = wantKeys.length > 0 && wantKeys.every((k) => have.has(k));
    return { files: art.length, bytes, scratchBytes, complete };
  }

  /** One-time crash-orphan sweep of the scratch dir; call before the first resolve (adapter does this). */
  async function sweepScratch() { await io.deleteTree('art-tmp').catch(noop); }

  return {
    resolve, download, downloadAll, quarantine, clear, stats, peek, legacySrc, sweepScratch,
    _debug: { get epoch() { return epoch; }, inflight, resolved, retried },
  };
}
