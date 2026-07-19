// Ambient declarations for the check:types closure. Deliberately minimal - one line, no `any`
// bridge. The Capacitor / import.meta.env needs live in TRANSITIVE files (deckRepository, db,
// cardArt), which the ownership filter excludes, so they are NOT declared here.
declare module '*.css';   // LifeCounter's side-effect CSS import; a stylesheet has no meaningful type
