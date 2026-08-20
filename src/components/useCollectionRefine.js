// The shared Collection refine machinery - filter/sort/group state, the debounced catalog pool, the
// live ownership maps, the per-tile owned-stepper, and the derived rows - for BOTH the per-set drill
// and the ALL view. Parameterised by `scope`:
//   { kind: 'set', name, code }  - one printed set (pool pinned to the set name; rows = that set's group)
//   { kind: 'all' }              - every set (no set filter; rows = every printing across every set)
// The pure axes (collectionFilter / groupCollection / groupCards) are unchanged; this hook is the
// stateful wiring both surfaces used to duplicate. It DERIVES rows; selection is a separate controller.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getPool, getArtists } from '../store/deckRepository.js';
import { parseQuery, cardMatchesQuery } from '../store/cardQuery.js';
import { isTokenCard } from '../store/tokens.js';
import { collectionSession } from '../pillars/collectionSession.js';
import { SET_LABEL, setRank } from '../store/sets.js';
import { groupCollection } from '../store/collectionGroups.js';
import { poolArgs, rowsForScope, filedKeysOf, withFiled } from '../store/collectionAllModel.js';
import { enqueueWrite } from '../store/collectionWrites.js';
import { createOwnedStepGrid } from '../store/ownedStepGrid.js';
import { activeProfileId } from '../store/profileRepository.js';
import { ownedBySet, wishlistCards, qtyForInSet, setOwnedInSet, ownedRowKey, subscribeCollection } from '../store/ownedRepository.js';
import { filedBySet } from '../store/storageDirectory.js';
import { predictGlobalRemovalRefusal } from '../store/storageRepository.js';
import { toast } from '../feedback.js';
import { showStepFailure } from './stepFailureToast.js';

const EMPTY_CMP = () => ({ op: '>=', val: null });

export function useCollectionRefine(scope) {
  const isSet = scope.kind === 'set';
  const setName = isSet ? scope.name : null;   // getPool filters by set NAME; groups are keyed by CODE
  const setCode = isSet ? scope.code : null;

  // Catalog axes (session-backed so a browse survives navigation): element/multi/type/rarity/artist.
  const [q, setQ] = useState(collectionSession().q);
  const [types, setTypes] = useState(collectionSession().types);
  const [rarities, setRarities] = useState(collectionSession().rarities);
  const [els, setEls] = useState(collectionSession().els);
  const [groupBy, setGroupBy] = useState(collectionSession().groupBy || 'none');
  useEffect(() => { collectionSession().q = q; collectionSession().types = types; collectionSession().rarities = rarities; collectionSession().els = els; collectionSession().groupBy = groupBy; }, [q, types, rarities, els, groupBy]);
  const [multi, setMulti] = useState(false);
  const [artist, setArtist] = useState('');
  const [artistOpts, setArtistOpts] = useState([]);
  // Ownership-derived axes + the within-group sort.
  const [states, setStates] = useState([]);           // ['owned'|'missing'|'wishlist']
  const [finishes, setFinishes] = useState([]);       // ['standard'|'foil'] - scopes the ownership math
  const [playset, setPlayset] = useState([]);         // ['complete'|'partial'|'over']
  const [ownedCmp, setOwnedCmp] = useState(EMPTY_CMP);
  const [sort, setSort] = useState('name-asc');
  const own = useMemo(() => ({ states, finishes, playset, qty: ownedCmp }), [states, finishes, playset, ownedCmp]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [optsLoaded, setOptsLoaded] = useState(false);
  useEffect(() => { getArtists().then(setArtistOpts).finally(() => setOptsLoaded(true)); }, []);

  const [pool, setPool] = useState(null);
  const [owBySet, setOwBySet] = useState(new Map());
  const [wishSet, setWishSet] = useState(() => new Set());   // wanted collector-item keys card_id|variant_slug
  const [addStatus, setAddStatus] = useState(new Map());
  const owRef = useRef(owBySet); owRef.current = owBySet;
  // Filed copies per tile, read on the SAME refresh as ownership. TWO consumers with different
  // needs, which is why there are two holders of one read:
  //  - the ref carries the QUANTITIES and is consulted only at tap time, to decide whether a
  //    decrease may paint. Nothing renders it, so it must not cause a render.
  //  - the state carries only WHICH tiles have anything filed, because the tile's filed seal is
  //    drawn, and a seal held in a ref would appear a whole navigation late.
  const filedRef = useRef(null);
  const [filedKeys, setFiledKeys] = useState(() => new Set());
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // The catalog pool, debounced. Set scope pins to the set name (a cross-set filter inside a set is a
  // contradiction); ALL scope passes no set filter, so getPool returns the whole catalogue once.
  const loadPool = useCallback(async () => {
    const parsed = parseQuery(q);
    const rows = await getPool(poolArgs({ kind: isSet ? 'set' : 'all', name: setName }, { q: parsed.name, els, types, rarities, multi, artist }));
    const real = rows.filter((c) => !isTokenCard(c));   // tokens aren't collected
    setPool(parsed.clauses.length ? real.filter((c) => cardMatchesQuery(c, parsed)) : real);
  }, [q, els, types, rarities, multi, artist, isSet, setName]);
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); }, [loadPool]);

  const refreshOwnership = useCallback(async () => {
    const [obs, wl, filed] = await Promise.all([ownedBySet(), wishlistCards(), filedBySet()]);
    filedRef.current = filed;
    // Keep the PREVIOUS set when nothing changed. Every ownership broadcast lands here, and a fresh
    // Set each time would re-derive every row object (and with them the arrangement) for a fact that
    // did not move.
    const nextFiled = filedKeysOf(filed);
    setFiledKeys((prev) => (prev.size === nextFiled.size && [...nextFiled].every((k) => prev.has(k)) ? prev : nextFiled));
    const grid = gridRef.current;
    if (grid) {
      for (const key of grid.keys()) {
        if (grid.pending(key) > 0) {
          const st = grid.state(key);
          obs.set(key, { ...(obs.get(key) || { owned: 0, foil: 0 }), owned: st.displayed });
        } else {
          grid.reseed(key, obs.get(key)?.owned || 0);
        }
      }
    }
    setOwBySet(obs);
    setWishSet(new Set(wl.map((r) => r.item_id)));
  }, []);
  useEffect(() => { refreshOwnership(); }, [refreshOwnership]);
  useEffect(() => {
    let t = null;
    const off = subscribeCollection(() => { clearTimeout(t); t = setTimeout(refreshOwnership, 250); });
    return () => { clearTimeout(t); off(); };
  }, [refreshOwnership]);

  // Per-tile owned stepper (same provisional/confirmed contract as the card sheet). Controllers are
  // created lazily per TAPPED row, so a large grid costs nothing until you actually edit a tile.
  const gridRef = useRef(null);
  if (gridRef.current === null) {
    const split = (key) => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };
    gridRef.current = createOwnedStepGrid({
      read: async (key) => { const [cardId, set] = split(key); return (await qtyForInSet(cardId, set)).owned; },
      write: (key, delta) => {
        const [cardId, set] = split(key);
        const pid = activeProfileId();
        return enqueueWrite(ownedRowKey(pid, cardId, set, false), async () => {
          const cur = await qtyForInSet(cardId, set, pid);
          return setOwnedInSet(cardId, set, Math.max(0, cur.owned + delta), pid);
        });
      },
      // GATE THE OPTIMISM, NEVER THE WRITE. A tile whose copies are filed refuses a decrease past
      // that total, and painting the new count only to snap it back made the wall look like a bug.
      // Predicting it lets the tap simply not paint - the toast below is then the only thing that
      // happens. The write still goes out: `filedRef` is a snapshot between refreshes, and a stale
      // prediction must cost at most a count that moves once at reconcile.
      //
      // `.owned` is the right finish because the tile stepper writes setOwnedInSet - the NON-foil
      // row - and the map is keyed exactly as the step key is, so the number belongs to the row the
      // write lands on.
      holdDelta: (key, delta, shown) => {
        if (delta >= 0) return false;
        const f = filedRef.current?.get(key)?.owned;
        return typeof f === 'number' && predictGlobalRemovalRefusal({ target: shown + delta, filed: f });
      },
      // A refusal is not a malfunction: stepFailureMessage tells a storage conflict apart from a
      // failed write, because reporting the wall as a bug teaches distrust of a wall that is
      // protecting the user's filing.
      notify: (reason, cause) => { void showStepFailure(reason, cause); },
      isAlive: () => aliveRef.current,
      onChange: (key, status) => {
        setOwBySet((prev) => { const m = new Map(prev); m.set(key, { ...(m.get(key) || { owned: 0, foil: 0 }), owned: status.displayed }); return m; });
        setAddStatus((prev) => new Map(prev).set(key, status));
      },
    });
  }
  const stepSet = useCallback((cardId, set, delta) => {
    const key = cardId + '|' + set;
    gridRef.current.step(key, owRef.current.get(key)?.owned || 0, delta);
  }, []);

  // Rows: the same pipeline for both scopes. Set scope renders one set's group; ALL flattens every set
  // (including the recovered Uncategorised pile) into one list. groupCards (in the view) sections + sorts.
  const groups = useMemo(() => groupCollection({
    pool, owBySet, wishSet, sets: isSet ? [setName] : [], own, setLabel: SET_LABEL, setRank,
  }), [pool, owBySet, wishSet, own, isSet, setName]);
  const rows = useMemo(
    () => withFiled(rowsForScope(groups, { kind: isSet ? 'set' : 'all', code: setCode }), filedKeys),
    [groups, isSet, setCode, filedKeys],
  );

  // activeCount = things that HIDE cards (Sort/Group are arrangements, excluded).
  const activeCount = states.length + finishes.length + playset.length + (ownedCmp.val != null ? 1 : 0)
    + types.length + rarities.length + els.length + (multi ? 1 : 0) + (artist ? 1 : 0);
  const clearAll = useCallback(() => {
    setStates([]); setFinishes([]); setPlayset([]); setOwnedCmp(EMPTY_CMP());
    setTypes([]); setRarities([]); setEls([]); setMulti(false); setArtist('');
  }, []);

  return {
    // filter state (spread into CollectionRefineSheet)
    q, setQ, els, setEls, multi, setMulti, types, setTypes, rarities, setRarities, artist, setArtist, artistOpts,
    states, setStates, finishes, setFinishes, playset, setPlayset, ownedCmp, setOwnedCmp, sort, setSort, groupBy, setGroupBy,
    own, activeCount, clearAll, filterOpen, setFilterOpen, optsLoaded,
    // data + derived
    pool, owBySet, wishSet, groups, rows, addStatus, stepSet, refreshOwnership,
  };
}
