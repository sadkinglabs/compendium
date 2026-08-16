// The app's mark, in one place: the gold diamond. LEAF module - imports nothing,
// so both the boot splash (App.jsx <BootDiamond>) and the pillar loading screen
// (PillarLoading.jsx) draw the SAME geometry instead of each keeping a copy that
// can drift. Vector only, so it is zero-image safe by construction.
export const DIAMOND_PATH = 'M50 5 L95 50 L50 95 L5 50 Z';
export const DIAMOND_GOLD = '#cba75f';
