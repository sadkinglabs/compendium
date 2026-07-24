// Bulk Edit-copies / New-list over a Collection selection - shared by the set drill AND the ALL view,
// so both honour the SAME atomic repository commands, the honest write-outcome contract, and the
// MAX_BATCH_ITEMS payload guard. The guard is computed on the ACTUAL payload (after finish eligibility
// for edit-copies; after card-grain dedup for a list) and, if it exceeds the limit, refuses the WHOLE
// action - never a partial write or a silent split - keeping the selection so the user can refine.
import { useCallback } from 'react';
import { toast } from '../feedback.js';
import { activeProfileId } from '../store/profileRepository.js';
import { adjustOwnedItemsBulk, setOwnedItemsBulk, createListWithEntries, addEntriesToList } from '../store/ownedImportRepository.js';
import { bulkWriteFailure } from '../store/bulkWriteOutcome.js';
import { editCopiesEligible, newListCardIds, overBatch, MAX_BATCH_ITEMS } from '../store/collectionSelection.js';

const LIMIT = MAX_BATCH_ITEMS.toLocaleString();

export function useCollectionBulkActions({ selected, cancelSelect, closeEdit, closeCreate, closeAddToList }) {
  const bulkEditCopies = useCallback(async ({ mode, qty, foil, dir }) => {
    const { items: eligible, skipped } = editCopiesEligible([...selected.values()], foil);
    if (!eligible.length) { toast(`None of the selected cards have a ${foil ? 'foil' : 'non-foil'} printing.`, { tone: 'warn' }); closeEdit(); return; }
    // Payload guard - refuse the WHOLE action over the limit (keep the selection; never split/partial).
    if (overBatch(eligible.length)) {
      toast(`${eligible.length.toLocaleString()} items selected. Refine to ${LIMIT} or fewer to edit copies.`, { tone: 'warn' });
      closeEdit();
      return;
    }
    const adjust = mode === 'adjust';
    const delta = dir === 'remove' ? -qty : qty;
    const items = eligible.map(({ card, set }) => (adjust
      ? { card_id: card.card_id, setCode: set, foil, delta }
      : { card_id: card.card_id, setCode: set, foil, qty }));
    const skipTail = skipped ? ` (${skipped} skipped - no ${foil ? 'foil' : 'non-foil'})` : '';
    const f = foil ? 'foil ' : '';
    const cnt = (nn) => `${nn} card${nn === 1 ? '' : 's'}`;
    try {
      if (adjust) {
        const r = await adjustOwnedItemsBulk(items);   // one atomic write; Remove floors at 0, keeping any want
        const changed = r.set + r.removed + r.cleared;
        const copies = dir === 'remove' ? r.copiesRemoved : r.copiesAdded;   // AUTHORITATIVE copy movement
        const cop = `${copies} ${f}cop${copies === 1 ? 'y' : 'ies'}`;
        toast(changed === 0
          ? `No change - ${cnt(r.unchanged)} unaffected${skipTail}`
          : (dir === 'remove' ? `Removed ${cop} across ${cnt(changed)}` : `Added ${cop} across ${cnt(changed)}`) + skipTail);
      } else {
        const r = await setOwnedItemsBulk(items);   // one atomic write; 0 removes, keeping any wishlist want
        const changed = qty === 0 ? (r.removed + r.cleared) : r.set;
        toast(changed === 0
          ? `No change - ${cnt(r.unchanged)} already ${qty === 0 ? 'empty' : `at ${qty}${foil ? ' foil' : ''}`}${skipTail}`
          : (qty === 0 ? `Removed ${f}from ${cnt(changed)}` : `Set ${cnt(changed)} to ${qty}${foil ? ' foil' : ''}`) + skipTail);
      }
      closeEdit(); cancelSelect();
    } catch (e) {
      console.error('bulkEditCopies failed', e);
      const o = bulkWriteFailure(e);
      toast(o.copy, { tone: o.tone });
      closeEdit();
      if (!o.keepSelection) cancelSelect();   // indeterminate: clear so it can't read as a retry invite
    }
  }, [selected, cancelSelect, closeEdit]);

  const createListFromSelection = useCallback(async (name, desc, kind) => {
    const cardIds = newListCardIds([...selected.values()]);   // dedup printings to card grain FIRST
    if (overBatch(cardIds.length)) {
      toast(`${cardIds.length.toLocaleString()} cards selected. Refine to ${LIMIT} or fewer to create a list.`, { tone: 'warn' });
      closeCreate();
      return;
    }
    try {
      const r = await createListWithEntries({ kind, name, description: desc, cardIds }, activeProfileId());
      toast(`Created “${r.name}” with ${r.entries} card${r.entries === 1 ? '' : 's'}`);
      closeCreate(); cancelSelect();
    } catch (e) {
      console.error('createListFromSelection failed', e);
      const o = bulkWriteFailure(e);
      toast(o.indeterminate ? "Couldn't confirm the list - check Lists before trying again." : "Couldn't create the list.", { tone: o.tone });
      closeCreate();
      if (!o.keepSelection) cancelSelect();
    }
  }, [selected, cancelSelect, closeCreate]);

  const addToListFromSelection = useCallback(async (listId, listName = 'list') => {
    const cardIds = newListCardIds([...selected.values()]);   // dedup printings to card grain FIRST
    if (overBatch(cardIds.length)) {
      toast(`${cardIds.length.toLocaleString()} cards selected. Refine to ${LIMIT} or fewer to add to a list.`, { tone: 'warn' });
      closeAddToList?.();
      return;
    }
    try {
      const r = await addEntriesToList({ listId, cardIds }, activeProfileId());   // one atomic write; existing skipped
      toast(r.added === 0
        ? `All ${r.skipped} already in “${listName}”`
        : `Added ${r.added} card${r.added === 1 ? '' : 's'} to “${listName}”${r.skipped ? ` (${r.skipped} already there)` : ''}`);
      closeAddToList?.(); cancelSelect();
    } catch (e) {
      console.error('addToListFromSelection failed', e);
      const o = bulkWriteFailure(e);
      toast(o.indeterminate ? "Couldn't confirm the add - check the list before trying again." : "Couldn't add to the list.", { tone: o.tone });
      closeAddToList?.();
      if (!o.keepSelection) cancelSelect();
    }
  }, [selected, cancelSelect, closeAddToList]);

  return { bulkEditCopies, createListFromSelection, addToListFromSelection };
}
