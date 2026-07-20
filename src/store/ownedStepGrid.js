// The ownership-step binding for a GRID of rows (the per-set card view), where mounting a
// controller per tile is not viable - a full set is ~780 tiles. Instead a controller is created
// lazily for a row the first time it is TAPPED, so only edited rows carry state, and every one
// of them gets the same provisional/confirmed contract the card sheet gets:
// pending tracking, drain reconciliation against the authoritative store, and a visible
// failure. Pure and injectable so the binding is testable without React or a DB.
//
// This exists because the grid previously wrote straight to the queue with no catch, no
// reconcile and no error surface - the primary "cheap add" surface could show ownership that
// was never durably committed.
//
//   read(key):           Promise<number>  authoritative quantity for that row
//   write(key, delta):   Promise          the durable, profile-bound write for one tap
//   notify(reason):      void             surface a failure to the user
//   isAlive():           boolean          false after unmount, to drop a late reconcile
//   onChange(key, state): void            re-render hook, per row
import { createOwnedStepController } from './ownedStepController.js';

export function createOwnedStepGrid({ read, write, notify = () => {}, isAlive = () => true, onChange = () => {} }) {
  const ctls = new Map();   // rowKey -> controller

  const controllerFor = (key, seedQty) => {
    let c = ctls.get(key);
    if (!c) {
      c = createOwnedStepController({
        read: () => read(key),
        write: (delta) => write(key, delta),
        notify,
        isAlive,
        onChange: (state) => onChange(key, state),
      });
      c.init(seedQty || 0);   // seed from what the grid is currently showing
      ctls.set(key, c);
    }
    return c;
  };

  return {
    /** A tap on one row. `seedQty` is the grid's current confirmed value for that row, used
        only the first time the row is touched. */
    step(key, seedQty, delta) { controllerFor(key, seedQty).step(delta); },
    /** In-flight writes for a row (0 when settled). */
    pending(key) { return ctls.get(key)?.pending() ?? 0; },
    /** Any row still writing. */
    pendingAny() { for (const c of ctls.values()) if (c.pending() > 0) return true; return false; },
    /** Re-seed a settled row from an authoritative refresh. Ignored while it has writes in
        flight (the controller guards this too) - and this is what confirms a row whose own
        reconcile read had failed. */
    reseed(key, qty) { ctls.get(key)?.init(qty); },
    /** Rows that currently carry state, for a caller reconciling a bulk refresh. */
    keys() { return [...ctls.keys()]; },
    state(key) { return ctls.get(key)?.getState() ?? null; },
  };
}
