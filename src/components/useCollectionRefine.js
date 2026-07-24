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
import { enqueueWrite } from '../store/collectionWrites.js';
import { createOwnedStepGrid } from '../store/ownedStepGrid.js';
import { activeProfileId } from '../store/profileRepository.js';
import { ownedBySet, wishlistCards, qtyForInSet, setOwnedInSet, ownedRowKey, subscribeCollection } from '../store/ownedRepository.js';
import { toast } from '../feedback.js';

const EMPTY_CMP = () => ({ op: '>=', val: null });

export function useCollectionRefine(scope) {
  const isSet = scope.kind === 'set';
  const setName = isSet ? scope.name : null;   // getPool filters by set NAME; groups are keyed by CODE

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
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // The catalog pool, debounced. Set scope pins to the set name (a cross-set filter inside a set is a
  // contradiction); ALL scope passes no set filter, so getPool returns the whole catalogue once.
  const loadPool = useCallback(async () => {
    const parsed = parseQuery(q);
    const rows = await getPool({ q: parsed.name, els, types, rarities, sets: isSet ? [setName] : undefined, multi, artist });
    const real = rows.filter((c) => !isTokenCard(c));   // tokens aren't collected
    setPool(parsed.clauses.length ? real.filter((c) => cardMatchesQuery(c, parsed)) : real);
  }, [q, els, types, rarities, multi, artist, isSet, setName]);
  useEffect(() => { const t = setTimeout(loadPool, 130); return () => clearTimeout(t); }, [loadPool]);

  const refreshOwnership = useCallback(async () => {
    const [obs, wl] = await Promise.all([ownedBySet(), wishlistCards()]);
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
      notify: (reason) => toast(
        reason === 'unconfirmed' ? "Saved, but couldn't refresh - reopen to confirm"
          : reason === 'save-failed-unresolved' ? "Couldn't save, and couldn't check - reopen to confirm"
            : "Couldn't save; count restored", { tone: 'danger' }),
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
  const rows = useMemo(() => (
    isSet ? (groups.find((g) => g.code === scope.code)?.rows || []) : groups.flatMap((g) => g.rows)
  ), [groups, isSet, scope.code]);

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
