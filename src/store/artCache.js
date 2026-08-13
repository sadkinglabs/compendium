// The one module that owns every byte of card art the app touches - resolving, caching, downloading,
// validating, clearing. A pure core over an injected `io` adapter (the only native-touching code lives
// in the adapter, wired in native.js), so single-flight, epoch, the promotion lock, and quarantine are
// unit-testable without Capacitor or a DOM. Run: npm run test:query
//
// Implements the approved design in docs/proposals/art-cdn-rev2-architecture.md Section B (B2 interface,
// B3 resolution, B3.5 candidate chain, B6 zero-image, B7 clear/stats). The load-bearing invariants:
//
//   - ZERO-IMAGE prohibits BOTH render AND I/O: resolve/download/peek all return null when
//     imagesDisabled(), at the top, before any Filesystem call (B6).
//   - LINEARIZATION: every write into art/ (a rename or a delete) happens inside a short promotion lock
//     with the request's epoch re-checked INSIDE the lock; the network download is never under the lock.
//   - NO CACHE-REPOPULATION AFTER clear(): a flight whose epoch was invalidated mid-air terminates in a
//     NON-CACHING staleResult() - it never memoizes, never downloads, never re-enters resolve(). Only a
//     genuinely new request under the new epoch may refill the cache.
//   - EXACT-SIZE VALIDATION, FAIL CLOSED: a cached file is trusted only if its byte count equals the
//     manifest's, and a key absent from the manifest is never cached or served.
//
// Sources are KIND-TAGGED { kind:'local'|'remote', src } - never bare strings (a native cached file
// becomes an https://localhost/_capacitor_file_/... URL a startsWith('http') sniff misreads).

const noop = () => {};

/**
 * @param deps.io          { stat(path)->{size}|null, download(url,path,expectedBytes)->bool (true iff the
 *                            fetched file is EXACTLY expectedBytes - the adapter decides fallback on it),
 *                            size(path)->number, rename(from,to), delete(path), deleteTree(path),
 *                            list(dir)->[{name,size}] }
 *                          paths are relative to Directory.Data ('art/<key>', 'art-tmp/<key>.<rand>').
 * @param deps.manifest    { objects: { <slug>: { key, bytes } } } - the shipped slim manifest
 * @param deps.isNative    () => boolean
 * @param deps.imagesDisabled () => boolean   (the zero-image gate; app-wide)
 * @param deps.remoteUrl   (key) => string    (ART_CDN_BASE + '/' + key)
 * @param deps.convertFileSrc (relPath) => string  (Directory.Data-relative art path -> WebView src; the
 *                          adapter does Filesystem.getUri + Capacitor.convertFileSrc; identity in tests)
 * @param deps.rand        () => string        (unique temp suffix; injected for deterministic tests)
 */
export function createArtCache(deps) {
  const { io, manifest, isNative, imagesDisabled, remoteUrl, convertFileSrc, rand } = deps;

  const inflight = new Map();   // key -> { epoch, promise }  (single-flight; joinable only within one epoch)
  const resolved = new Map();   // key -> {kind,src}          (session memo; feeds peek)
  const retried  = new Set();   // keys quarantined+retried once this session
  const transientRetries = new Map();   // key -> count of verified-transient quarantine retries (on device
                                        // the _capacitor_file_ server can refuse loads during early boot
                                        // while the file is fine; bounded so a boot race cannot loop forever)
  const painted  = new Set();   // keys whose <img> completed a decode this session (feeds the no-refade
                                // decision; quarantine/clear evict, so a genuine re-download shimmers)
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

  /** Memoized prior resolution, for a flash-free first paint. Web is deterministic (remote); native
   *  returns the cached-local memo or null (which sends the hook to resolve()). */
  function peek(key) {
    if (!key || imagesDisabled()) return null;
    if (!isNative()) return remoteCand(key);
    return resolved.get(key) || null;
  }

  /**
   * Warm peek()'s memo from disk, once, at boot - the fix for the cold-index flash: the memo used to
   * start empty every launch, so the first sighting of every key rendered nothing while an io.stat
   * ran, even though the file was sitting in art/ the whole time.
   *
   * One io.list() for the whole directory, and an entry is admitted ONLY when the manifest knows the
   * key and the on-disk size equals the manifest's byte count - the same fail-closed rule resolve()
   * applies per file (Codex: peek must never get ahead of validation). Anything that does not match
   * exactly is left unseeded, so the first resolve() of that key stats, deletes and re-fetches it
   * just as it does today.
   *
   * Epoch-guarded like every other flight: a clear() while the list is in the air must not let stale
   * entries repopulate the memo it just wiped.
   */
  async function seedFromDisk() {
    if (!isNative() || imagesDisabled()) return 0;   // zero-image: no I/O; web: peek is already immediate
    const reqEpoch = epoch;
    const files = await io.list('art').catch(() => []);
    if (reqEpoch !== epoch) return 0;
    let n = 0;
    for (const f of files) {
      if (!resolved.has(f.name) && validSize(f.name, f.size || 0)) {
        resolved.set(f.name, { kind: 'local', src: convertFileSrc(`art/${f.name}`) });
        n++;
      }
    }
    return n;
  }

  /** Has this key's <img> completed a decode this session? Read by CardArt at render time to skip
   *  the shimmer/fade on a remount - presentation state, deliberately NOT part of resolution. */
  const hasPainted = (key) => painted.has(key);
  /** Called from the <img> onLoad. */
  const markPainted = (key) => { if (key) painted.add(key); };

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

        const entry = entryOf(key);
        if (!entry) return staleResult(key);                            // unknown key: any bad cached file is now
                                                                        // deleted; NEVER download or promote it

        tmp = `art-tmp/${key}.${rand()}`;                                // unique temp in the SCRATCH sibling
        // Pass the expected byte count so the adapter validates the fetched bytes and DECIDES when to fall
        // back (a truncated downloadFile must trigger CapacitorHttp, not report success). The core still
        // re-checks validSize against the manifest - defence in depth, never trusting the boolean alone.
        const ok = await io.download(remoteUrl(key), tmp, entry.bytes);
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

  /** onError for a LOCAL candidate. The load failure does not prove the file is bad: on device the
   *  _capacitor_file_ server can refuse loads during early boot while the bytes on disk are perfect,
   *  and deleting on that evidence alone cost a fresh download of every deck art on cold launch. So
   *  verify first: a file still matching the manifest is handed back for a bounded remount retry;
   *  only a missing or wrong-size file gets the delete + retry-once + remote fallback. Epoch-checked
   *  after every await; a clear() mid-verification wins with staleResult and no writes. */
  async function quarantine(key) {
    if (!key || !isNative()) return staleResult(key);
    const reqEpoch = epoch;
    const st = await io.stat(`art/${key}`).catch(() => null);           // a throwing stat reads as missing:
                                                                        // fail toward today's quarantine, never reject
    if (reqEpoch !== epoch) return staleResult(key);                    // cleared mid-stat: no writes, no seeding
    if (st && validSize(key, st.size)) {
      // The file is exactly what the manifest promised, so the failure was transient. Keep the file,
      // keep painted (nothing is re-downloading, so a shimmer would lie), keep the once-per-session
      // retried slot; return the local candidate so the hook remounts the <img> and retries the load.
      // Past two retries this session the key falls back to remote WITHOUT deleting - the file is
      // valid and the next session serves it.
      const n = (transientRetries.get(key) || 0) + 1;
      transientRetries.set(key, n);
      if (n > 2) return staleResult(key);
      return { kind: 'local', src: convertFileSrc(`art/${key}`) };
    }
    resolved.delete(key);
    painted.delete(key);   // the re-download is a genuine first load again, so it must shimmer
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
    transientRetries.clear();   // the files are gone; post-clear failures are a new story, not this one
    painted.clear();       // post-clear loads are first loads; suppressing their shimmer would hide them
    await withPromotionLock(() => io.deleteTree('art').catch(noop));
    // Best-effort scratch sweep: remove ordinary orphaned temps too (a stale flight that lands after
    // this stays safe - its own finally deletes its unique temp). Not under the lock: art-tmp is never
    // the promotion target. The pack stamp stays deferred to Phase 3.
    await io.deleteTree('art-tmp').catch(noop);
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
    resolve, download, downloadAll, quarantine, clear, stats, peek, sweepScratch,
    seedFromDisk, hasPainted, markPainted,
    _debug: { get epoch() { return epoch; }, inflight, resolved, retried, painted, transientRetries },
  };
}
