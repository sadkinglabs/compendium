// Pure state transition for the Storage ledger inside CollectionCardSheet. Persistence owns the
// equality; this keeps the immediately rendered ledger on the same side of it while the collection
// subscription catches up.

/** Apply an absolute named-place target and derive Unfiled as the live remainder. */
export function applyLedgerTarget(ledger, containerId, qty) {
  if (!ledger || !Number.isSafeInteger(qty) || qty < 0) return ledger;
  const target = ledger.places?.find((p) => p.id === containerId);
  if (!target || target.is_system) return ledger;
  const namedTotal = ledger.places.reduce(
    (sum, p) => sum + (p.is_system ? 0 : (p.id === containerId ? qty : Number(p.qty) || 0)),
    0,
  );
  return {
    ...ledger,
    places: ledger.places.map((p) => (p.id === containerId
      ? { ...p, qty }
      : p.is_system ? { ...p, qty: Math.max(0, (Number(ledger.total) || 0) - namedTotal) } : p)),
  };
}
