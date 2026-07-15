// Shared ownership-UI primitives, so the ruby +/- stepper is pixel-identical
// wherever ownership is recorded (the Collection pillar's Cards tab and the
// OwnedControl detail block) and the serialized-write pattern has one home.

// Ruby-tinted stepper button (accent is chrome-only - it lives on the button,
// never on the card content). Lifted from the Collection Cards tab.
export const stepBtn = {
  width: 30, height: 30, flex: 'none', borderRadius: 8, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  font: "600 17px/1 var(--f-ui)", color: 'var(--accent-ruby)',
  background: 'rgba(210,88,115,.08)', border: '1px solid rgba(210,88,115,.32)',
};

// Serialize async writes per key on a ref-held promise chain, so rapid +/- taps
// commit in order - each write's read-modify-write sees the prior commit (owned
// and wanted share a row, so their writes must not interleave). Returns the
// chained promise so callers can attach .finally (e.g. an in-flight counter).
export function serialChain(ref, key, fn) {
  const next = (ref.current[key] || Promise.resolve()).then(fn).catch(() => {});
  ref.current[key] = next;
  return next;
}

// THE app-wide write chain for the owned_cards ledger, keyed by card_id. Every
// surface that mutates owned/wanted (the Cards tab's row steppers, the shared
// CollectionCardSheet / OwnedControl ledger hook) MUST queue through this one
// chain - two surfaces can show the same card at once, and each keeps its own
// optimistic mirror; serializing on one module-level chain (with each write
// re-reading qtyFor inside its turn) is what makes a sheet edit and a list-row
// edit for the same card unable to race an absolute write against each other.
export const ownedChains = { current: {} };
