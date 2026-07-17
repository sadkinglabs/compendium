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

// The owned_cards write serialization moved to the store layer: every interactive
// ledger writer now queues through `enqueueWrite` in src/store/collectionWrites.js,
// keyed per PERSISTED ROW (ownedRowKey/listRowKey) and bound to an explicit profile.
// `serialChain`/`ownedChains` are retired - see docs/proposals/collection-write-integrity.md.
