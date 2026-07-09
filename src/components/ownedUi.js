// Shared ownership-UI primitives, so the ruby +/- stepper is pixel-identical
// wherever ownership is recorded (the Collection pillar's Cards tab and the
// OwnedControl detail block) and the serialized-write pattern has one home.

// Ruby-tinted stepper button (accent is chrome-only - it lives on the button,
// never on the card content). Lifted verbatim from the Collection Cards tab.
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
