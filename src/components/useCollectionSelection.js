// The shared bulk-selection controller for a Collection grid (set drill AND the ALL view). Thin React
// wrapper over the pure snapshot reducer in store/collectionSelection.js - the parent owns the derived
// rows and hands them in for a toggle / select-all, so this hook never reads filter state. The snapshot
// changes ONLY on an explicit user action; filters and progressive rendering never touch it.
import { useState, useCallback } from 'react';
import { selectAllRows, toggleSelected, hiddenSelectedCount } from '../store/collectionSelection.js';

export function useCollectionSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Map());   // 'card_id|set' -> { card, set, owned, foil }

  const enter = useCallback(() => { setSelected(new Map()); setSelectMode(true); }, []);   // enter empty
  const cancel = useCallback(() => { setSelectMode(false); setSelected(new Map()); }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  const toggle = useCallback((cardId, set, rows) => setSelected((s) => toggleSelected(s, cardId, set, rows)), []);
  const selectAll = useCallback((rows) => setSelected((s) => selectAllRows(s, rows)), []);   // UNION, not replace
  const deselectAll = useCallback(() => setSelected(new Map()), []);   // the explicit full clear

  return { selectMode, selected, enter, cancel, clear, toggle, selectAll, deselectAll, hiddenSelectedCount };
}
